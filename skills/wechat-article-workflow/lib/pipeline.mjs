/**
 * 发布流水线：打包校验 -> 上传图 -> 建草稿 -> 通知 -> 归档。
 *
 * 默认配图策略：每篇只做一张封面图 cover.png。
 * 它同时用作草稿封面（thumb_media_id）和正文首图（COVER_AS_LEAD_IMAGE=true）。
 *
 * 模式差异集中在这一层：
 *   draft_only          仅草稿
 *   draft_notify_feishu 草稿 + 飞书待办（服务器生产默认）
 *   api_freepublish     草稿 + freepublish（实验）
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { boolOf, PUBLISH_MODES } from './config.mjs';
import { buildDraftReadyText, FeishuNotifier } from './feishu.mjs';
import { buildFooter } from './footer.mjs';
import { buildPostDraftSettings, renderPostDraftText } from './post-draft.mjs';
import {
  collectLocalImages, deriveSummary, markdownToHtml, parseFrontmatter, THEMES,
} from './markdown.mjs';
import { WechatClient } from './wechat.mjs';
import { clearProxyEnv, isoLocal, log, PipelineError, sniffImageType } from './util.mjs';

const COVER_NAMES = ['cover.png', 'cover.jpg', 'cover.jpeg'];

/** 找齐当日包文件：article.md + 封面。 */
export function resolvePackage(packageDir) {
  const dir = resolve(packageDir);
  const articlePath = join(dir, 'article.md');
  if (!existsSync(articlePath)) {
    throw new PipelineError(`找不到 article.md：${articlePath}`, { stage: 'package' });
  }
  const coverName = COVER_NAMES.find((name) => existsSync(join(dir, name)));
  if (!coverName) {
    throw new PipelineError(`找不到封面（${COVER_NAMES.join(' / ')}）：${dir}`, { stage: 'package' });
  }
  return { dir, articlePath, coverPath: join(dir, coverName) };
}

/** 发布前静态检查，不联网。 */
export function inspectPackage(packageDir, values = {}) {
  const { dir, articlePath, coverPath } = resolvePackage(packageDir);
  const raw = readFileSync(articlePath, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);
  const title = meta.title || '';
  const summary = meta.summary || meta.digest || deriveSummary(body);
  const images = collectLocalImages(body);
  const theme = meta.theme || values.THEME || 'default';

  const problems = [];
  if (!title) problems.push('article.md 的 frontmatter 缺少 title');
  if (title.length > 64) problems.push(`标题 ${title.length} 字，超过微信 64 字上限`);
  if (!summary) problems.push('缺少 summary，且正文无法推断摘要');
  if (summary.length > 120) problems.push(`摘要 ${summary.length} 字，超过微信 120 字上限`);

  if (!THEMES[theme]) problems.push(`未知排版主题：${theme}。可选：${Object.keys(THEMES).join(' | ')}`);

  const coverType = sniffImageType(readFileSync(coverPath));
  if (!coverType) problems.push(`封面不是有效图片：${basename(coverPath)}`);

  const missingImages = [];
  for (const rel of images) {
    const abs = join(dir, rel);
    if (!existsSync(abs)) {
      missingImages.push(rel);
      problems.push(`正文引用的图片不存在：${rel}`);
      continue;
    }
    if (!sniffImageType(readFileSync(abs))) {
      problems.push(`正文图片不是有效图片：${rel}`);
    }
  }

  return {
    dir, articlePath, coverPath, coverType, meta, body,
    title, summary, theme, images, missingImages, problems,
  };
}

/** 正文首图：与封面同图，样式和正文其它图保持一致。 */
function leadImageHtml(url, alt) {
  const style = 'max-width:100%;height:auto;display:block;margin:0 auto 1em;border-radius:4px;';
  return `<img src="${url}" alt="${alt}" style="${style}" />`;
}

function archive(dir, result) {
  const outDir = join(dir, 'output');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'publish-status.json');
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
  return file;
}

/**
 * 执行发布。
 * @param {string} packageDir 当日包目录
 * @param {object} values 已加载的配置
 * @param {object} opts { dryRun }
 */
export async function publish(packageDir, values, opts = {}) {
  const mode = values.PUBLISH_MODE;
  const startedAt = new Date();

  if (!PUBLISH_MODES.includes(mode)) {
    throw new PipelineError(
      `PUBLISH_MODE 非法：${mode}。合法值：${PUBLISH_MODES.join(' | ')}`,
      { stage: 'mode' },
    );
  }

  const pkg = inspectPackage(packageDir, values);
  if (pkg.problems.length) {
    throw new PipelineError(`当日包校验未通过：\n  - ${pkg.problems.join('\n  - ')}`, { stage: 'package' });
  }
  log.ok(`当日包校验通过：${pkg.dir}`);
  log.info(`标题：${pkg.title}`);
  log.info(`摘要：${pkg.summary}`);
  log.info(`正文图 ${pkg.images.length} 张，排版主题 ${pkg.theme}`);

  // 先构建文末区块：链接不合法要在任何上传之前就失败，别浪费素材配额
  const footer = buildFooter(values.projectDir || process.cwd(), values);

  const cleared = clearProxyEnv();
  if (cleared.length) log.info(`已清理代理变量：${cleared.join(', ')}`);

  const result = {
    success: false,
    publish_mode: mode,
    status: 'started',
    approval: null,
    timestamp: isoLocal(startedAt),
    title: pkg.title,
    summary: pkg.summary,
    author: pkg.meta.author || values.WECHAT_AUTHOR || values.WECHAT_ACCOUNT_DISPLAY_NAME || '',
    account: values.WECHAT_ACCOUNT_DISPLAY_NAME || null,
    account_slug: values.WECHAT_ACCOUNT_SLUG || null,
    package_dir: relative(values.projectDir || process.cwd(), pkg.dir) || '.',
    media_id: null,
    thumb_media_id: null,
    lead_image: null,
    footer: null,
    post_draft_settings: null,
    collection: null,
    content_images: [],
    publish_id: null,
    article_id: null,
    article_url: null,
    publish_status: null,
    formal_publish: false,
    technical_success: false,
    operational_success: null,
    feishu_draft_notify: null,
    error: null,
    notes: [],
  };

  if (opts.dryRun) {
    result.status = 'dry_run';
    result.success = true;
    result.notes.push('dry_run：只做打包校验与 HTML 渲染，不调用微信与飞书');
    const leadEnabled = boolOf(values.COVER_AS_LEAD_IMAGE, true);
    const html = leadEnabled
      ? `${leadImageHtml('(封面图 URL，发布时生成)', pkg.title)}\n${markdownToHtml(pkg.body, { theme: pkg.theme })}`
      : markdownToHtml(pkg.body, { theme: pkg.theme });
    result.lead_image = leadEnabled ? { source: basename(pkg.coverPath), url: null } : null;
    const dryPost = buildPostDraftSettings({
      title: pkg.title, body: pkg.body, values, meta: pkg.meta,
    });
    result.post_draft_settings = dryPost.items;
    result.collection = dryPost.collection.name;
    result.footer = footer.html ? {
      past_articles: footer.pastCount,
      footer_md: footer.hasFooterMd,
      profile_card: footer.hasProfile,
    } : null;
    result.html_length = html.length + footer.html.length;
    const file = archive(pkg.dir, result);
    log.ok(`dry-run 完成，HTML ${html.length} 字符，归档 ${file}`);
    return result;
  }

  const wx = new WechatClient({
    appId: values.WECHAT_APP_ID,
    appSecret: values.WECHAT_APP_SECRET,
    apiBase: values.WECHAT_API_BASE,
    logger: (msg) => log.info(msg),
  });

  try {
    log.step('获取 access_token');
    await wx.getAccessToken();

    log.step('上传封面为永久素材');
    result.thumb_media_id = await wx.uploadPermanentImage(pkg.coverPath);
    log.ok(`thumb_media_id=${result.thumb_media_id}`);

    let body = pkg.body;
    if (pkg.images.length) {
      log.step(`上传正文图 ${pkg.images.length} 张`);
      for (const rel of pkg.images) {
        const url = await wx.uploadContentImage(join(pkg.dir, rel));
        body = body.split(`./${rel}`).join(url).split(`(${rel})`).join(`(${url})`);
        result.content_images.push({ local: rel, url });
        log.ok(`${rel} -> ${url}`);
      }
    }

    log.step('渲染正文 HTML');
    let html = markdownToHtml(body, { theme: pkg.theme });

    // 默认策略：封面同一张图放到正文最前面，不再单独生成其它配图
    if (boolOf(values.COVER_AS_LEAD_IMAGE, true)) {
      log.step('上传封面为正文首图');
      const leadUrl = await wx.uploadContentImage(pkg.coverPath);
      html = `${leadImageHtml(leadUrl, pkg.title)}\n${html}`;
      result.lead_image = { source: basename(pkg.coverPath), url: leadUrl };
      log.ok(`正文首图 ${leadUrl}`);
    }

    // 文末固定区块：往期文章 + 自我介绍 + 公众号名片
    if (footer.html) {
      html = `${html}\n${footer.html}`;
      result.footer = {
        past_articles: footer.pastCount,
        footer_md: footer.hasFooterMd,
        profile_card: footer.hasProfile,
      };
      log.ok(`文末区块已附加：往期 ${footer.pastCount} 篇，名片 ${footer.hasProfile ? '有' : '无'}`);
    }

    result.html_length = html.length;
    log.info(`HTML ${html.length} 字符`);

    log.step('创建草稿');
    result.media_id = await wx.createDraft({
      title: pkg.title,
      author: result.author,
      digest: pkg.summary,
      content: html,
      thumbMediaId: result.thumb_media_id,
      contentSourceUrl: pkg.meta.source_url || '',
      needOpenComment: boolOf(values.NEED_OPEN_COMMENT, true),
      onlyFansCanComment: boolOf(values.ONLY_FANS_CAN_COMMENT, false),
    });
    result.technical_success = true;
    result.status = 'draft_created';
    log.ok(`media_id=${result.media_id}`);

    // 原创 / 赞赏 / 合集 / 广告：API 不支持，生成后台待办清单
    const post = buildPostDraftSettings({
      title: pkg.title, body: pkg.body, values, meta: pkg.meta,
    });
    result.post_draft_settings = post.items;
    result.collection = post.collection.name;
    if (post.items.length) {
      log.warn('以下四项微信 API 不支持，需在后台或通道 B 设置：');
      for (const item of post.items) log.info(`${item.label}：${item.value}`);
    }

    if (mode === 'api_freepublish') {
      log.step('提交 freepublish（实验模式）');
      result.publish_id = await wx.freepublishSubmit(result.media_id);
      const waited = await wx.freepublishWait(result.publish_id, {
        attempts: Number(values.FREEPUBLISH_ATTEMPTS || 20),
        intervalMs: Number(values.FREEPUBLISH_INTERVAL_MS || 3000),
      });
      result.publish_status = waited.publish_status;
      result.article_id = waited.article_id;
      result.article_url = waited.article_url;
      result.formal_publish = waited.publish_status === 0;
      result.status = waited.publish_status === 0 ? 'published' : 'freepublish_pending';
      result.notes.push('freepublish 成功不代表公众号主页/列表可见性正常，需人工核对');
      result.success = waited.publish_status === 0 || waited.publish_status === 2;
    } else if (mode === 'draft_notify_feishu' && boolOf(values.FEISHU_DRAFT_NOTIFY_ENABLED, true)) {
      log.step('发送飞书草稿就绪通知');
      const notifier = new FeishuNotifier({
        driver: values.FEISHU_DRIVER,
        apiBase: values.FEISHU_API_BASE,
        appId: values.FEISHU_APP_ID,
        appSecret: values.FEISHU_APP_SECRET,
        openId: values.FEISHU_NOTIFY_OPEN_ID,
        chatId: values.FEISHU_NOTIFY_CHAT_ID,
        logger: (msg) => log.info(msg),
      });
      const sentAt = new Date();
      const text = buildDraftReadyText({
        account: values.WECHAT_ACCOUNT_DISPLAY_NAME,
        title: pkg.title,
        summary: pkg.summary,
        mediaId: result.media_id,
        mpHome: values.WECHAT_MP_HOME_URL,
        at: sentAt,
        extraSteps: renderPostDraftText(result.post_draft_settings || []),
      });
      const messageId = await notifier.sendText(text, pkg.dir);
      let coverMessageId = null;
      try {
        coverMessageId = await notifier.sendImage(basename(pkg.coverPath), pkg.dir);
      } catch (err) {
        log.warn(`封面图未能推送到飞书：${err.message}`);
      }
      result.feishu_draft_notify = {
        enabled: true,
        driver: values.FEISHU_DRIVER,
        sent_at: isoLocal(sentAt),
        target: values.FEISHU_NOTIFY_OPEN_ID || values.FEISHU_NOTIFY_CHAT_ID,
        message_id: messageId,
        mp_home_url: values.WECHAT_MP_HOME_URL,
        optional_cover_message_id: coverMessageId,
      };
      result.status = 'draft_ready_notified';
      result.approval = 'awaiting_human_mp_publish';
      result.success = true;
      result.notes.push('本 run 成功 = media_id + 飞书通知；正式发表由管理员在后台完成');
      log.ok(`飞书已通知，message_id=${messageId}`);
    } else {
      result.status = 'draft_only';
      result.success = true;
      result.notes.push('draft_only：草稿已入箱，未发送通知');
    }
  } catch (err) {
    result.error = { stage: err.stage || 'unknown', message: err.message };
    result.status = 'failed';
    result.success = false;
    archive(pkg.dir, result);
    throw err;
  }

  const file = archive(pkg.dir, result);
  log.ok(`归档：${file}`);
  return result;
}
