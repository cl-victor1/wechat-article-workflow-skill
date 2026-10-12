#!/usr/bin/env node
/**
 * wxpub：微信公众号自动发文命令行。
 *
 * 子命令：
 *   topics    选题雷达：抓公开热榜
 *   init      在当前项目生成 .wxpub/.env 与当日包骨架
 *   doctor    体检：运行时、配置、连通性
 *   new       新建当日包 output/YYYY-MM-DD/
 *   render    只渲染 HTML 预览，不联网
 *   publish   按 PUBLISH_MODE 发布
 *   notify    单独发飞书草稿就绪消息
 *   selftest  用本地 mock 服务跑端到端自测
 */

import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  boolOf, displayValue, envFileCandidates, KNOWN_KEYS, loadConfig,
  PUBLISH_MODES, validateConfig,
} from '../lib/config.mjs';
import { buildDraftReadyText, FeishuNotifier } from '../lib/feishu.mjs';
import { markdownToHtml, parseFrontmatter, THEMES } from '../lib/markdown.mjs';
import { buildFooter, footerFiles, loadPastArticles, replaceFooter } from '../lib/footer.mjs';
import { generateCover } from '../lib/image-gen.mjs';
import { collectionsFile } from '../lib/post-draft.mjs';
import { publish } from '../lib/pipeline.mjs';
import { DEFAULT_SOURCES, gatherTopics, SOURCES, topicsToMarkdown } from '../lib/topics.mjs';
import { WechatClient } from '../lib/wechat.mjs';
import { clearProxyEnv, log, PipelineError, today } from '../lib/util.mjs';

const execFileAsync = promisify(execFile);
const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item.startsWith('--')) {
      const [key, inlineValue] = item.slice(2).split('=');
      if (inlineValue !== undefined) {
        args.flags[key] = inlineValue;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        args.flags[key] = argv[i + 1];
        i += 1;
      } else {
        args.flags[key] = true;
      }
    } else {
      args._.push(item);
    }
  }
  return args;
}

function usage() {
  console.log(`用法：wxpub <命令> [选项]

命令：
  topics [--sources a,b] [--limit 10] [--rss URL] [--geo US] [--out 文件] [--json]
                            选题雷达：抓公开热榜，输出 Markdown
  init                      生成 .wxpub/.env 与目录骨架
  doctor [--online]         体检配置；--online 时真连微信与飞书
  new [--date YYYY-MM-DD]   新建当日包
  cover <包目录> [--prompt P] [--ratio 16:9]  用 kie.ai 生成封面图
  render <包目录> [--theme T] [--preview] [--out 文件]  排版：渲染 HTML 或生成手机宽度预览页，不联网
  publish <包目录> [--mode M] [--dry-run] [--auto-cover]  发布
  notify --draft-ready --title T --summary S --media-id M
  past list                 列出往期文章
  past add --title T --url U  往期文章列表最前面加一篇
  past remove --url U       从列表移除一篇
  draft delete <media_id>…  删除草稿箱里的草稿
  draft refresh-footer [<media_id>…] [--dry-run]  用当前配置重建草稿的文末区块
  footer                    预览文末区块 HTML
  selftest                  本地 mock 端到端自测

通用选项：
  --project <目录>          指定项目目录（默认当前目录）
  --help                    显示本帮助

发布模式：${PUBLISH_MODES.join(' | ')}`);
}

function makeNotifier(values) {
  return new FeishuNotifier({
    driver: values.FEISHU_DRIVER,
    apiBase: values.FEISHU_API_BASE,
    appId: values.FEISHU_APP_ID,
    appSecret: values.FEISHU_APP_SECRET,
    openId: values.FEISHU_NOTIFY_OPEN_ID,
    chatId: values.FEISHU_NOTIFY_CHAT_ID,
    logger: (msg) => log.info(msg),
  });
}

async function cmdInit(args) {
  const projectDir = resolve(args.flags.project || process.cwd());
  const envDir = join(projectDir, '.wxpub');
  const envFile = join(envDir, '.env');

  mkdirSync(envDir, { recursive: true });
  if (existsSync(envFile)) {
    log.warn(`已存在，未覆盖：${envFile}`);
  } else {
    copyFileSync(join(SKILL_ROOT, 'templates', 'env.example.txt'), envFile);
    log.ok(`已生成：${envFile}`);
  }

  const { footerMd, pastArticles } = footerFiles(projectDir);
  if (existsSync(footerMd)) {
    log.warn(`已存在，未覆盖：${footerMd}`);
  } else {
    copyFileSync(join(SKILL_ROOT, 'templates', 'footer.example.md'), footerMd);
    log.ok(`已生成文末文案：${footerMd}`);
  }
  if (existsSync(pastArticles)) {
    log.warn(`已存在，未覆盖：${pastArticles}`);
  } else {
    copyFileSync(join(SKILL_ROOT, 'templates', 'past-articles.example.json'), pastArticles);
    log.ok(`已生成往期文章列表：${pastArticles}`);
  }

  const collections = collectionsFile(projectDir);
  if (existsSync(collections)) {
    log.warn(`已存在，未覆盖：${collections}`);
  } else {
    copyFileSync(join(SKILL_ROOT, 'templates', 'collections.example.json'), collections);
    log.ok(`已生成合集规则：${collections}`);
  }

  const pkgDir = join(projectDir, 'output', today());
  mkdirSync(pkgDir, { recursive: true });
  const articlePath = join(pkgDir, 'article.md');
  if (!existsSync(articlePath)) {
    copyFileSync(join(SKILL_ROOT, 'templates', 'article-template.md'), articlePath);
    log.ok(`已生成当日包：${pkgDir}`);
  }

  log.plain('');
  log.plain('下一步：');
  log.plain(`  1. 编辑 ${envFile}，填 WECHAT_APP_ID / WECHAT_APP_SECRET（飞书按需）`);
  log.plain('  2. 把服务器出口 IP 加入微信公众号后台的 IP 白名单');
  log.plain(`  3. 编辑 ${footerMd} 与 ${pastArticles}，换成你自己的文案与往期链接`);
  log.plain(`  4. 编辑 ${collections}，换成你自己的合集名与关键词`);
  log.plain('  5. 运行 wxpub doctor --online 验证');
  return 0;
}

async function cmdDoctor(args) {
  const projectDir = resolve(args.flags.project || process.cwd());
  const { values, sources, loadedFiles } = loadConfig(projectDir);
  let failed = false;

  log.step('运行时');
  log.info(`node ${process.version}`);
  for (const tool of ['lark-cli']) {
    try {
      const { stdout } = await execFileAsync(tool, ['--version'], { timeout: 10000 });
      log.info(`${tool} ${stdout.trim().split('\n')[0]}`);
    } catch {
      log.info(`${tool} 未安装（可选，仅 FEISHU_DRIVER=lark-cli 需要）`);
    }
  }

  log.step('配置文件');
  if (loadedFiles.length === 0) {
    log.warn(`未找到 .env，查找路径：${envFileCandidates(projectDir).join(' , ')}`);
  }
  for (const file of loadedFiles) log.info(`已加载 ${file}`);

  log.step('配置项');
  for (const key of KNOWN_KEYS) {
    const value = values[key];
    if (!value) continue;
    log.info(`${key} = ${displayValue(key, value)}  [${sources[key] || 'default'}]`);
  }

  log.step('模式校验');
  const { errors, warnings } = validateConfig(values);
  for (const warn of warnings) log.warn(warn);
  for (const err of errors) {
    log.fail(err);
    failed = true;
  }
  if (!errors.length) log.ok(`模式 ${values.PUBLISH_MODE} 配置完整`);

  if (args.flags.online) {
    const cleared = clearProxyEnv();
    if (cleared.length) log.info(`已清理代理变量：${cleared.join(', ')}`);

    log.step('微信连通性');
    if (!values.WECHAT_APP_ID || !values.WECHAT_APP_SECRET) {
      log.warn('缺少微信凭证，跳过');
    } else {
      try {
        const wx = new WechatClient({
          appId: values.WECHAT_APP_ID,
          appSecret: values.WECHAT_APP_SECRET,
          apiBase: values.WECHAT_API_BASE,
        });
        await wx.getAccessToken();
        log.ok('access_token 获取成功（IP 白名单通过）');
      } catch (err) {
        log.fail(err.message);
        if (String(err.message).includes('40164')) {
          log.info('40164 = 出口 IP 不在白名单。到公众号后台「基本配置 → IP 白名单」添加。');
        }
        failed = true;
      }
    }

    log.step('飞书连通性');
    if (values.FEISHU_DRIVER === 'api' && values.FEISHU_APP_ID && values.FEISHU_APP_SECRET) {
      try {
        await makeNotifier(values).getTenantToken();
        log.ok('tenant_access_token 获取成功');
      } catch (err) {
        log.fail(err.message);
        failed = true;
      }
    } else if (values.FEISHU_DRIVER === 'lark-cli') {
      try {
        const { stdout } = await execFileAsync('lark-cli', ['auth', 'status'], { timeout: 20000 });
        log.info(stdout.trim().split('\n').slice(0, 3).join(' | '));
      } catch (err) {
        log.fail(`lark-cli auth status 失败：${err.message}`);
        failed = true;
      }
    } else {
      log.warn('缺少飞书凭证，跳过');
    }
  }

  log.plain('');
  if (failed) {
    log.fail('体检未通过');
    return 1;
  }
  log.ok('体检通过');
  return 0;
}

async function cmdNew(args) {
  const projectDir = resolve(args.flags.project || process.cwd());
  const date = typeof args.flags.date === 'string' ? args.flags.date : today();
  const pkgDir = join(projectDir, 'output', date);
  mkdirSync(pkgDir, { recursive: true });
  const articlePath = join(pkgDir, 'article.md');
  if (existsSync(articlePath)) {
    log.warn(`已存在，未覆盖：${articlePath}`);
  } else {
    copyFileSync(join(SKILL_ROOT, 'templates', 'article-template.md'), articlePath);
    log.ok(`已生成：${articlePath}`);
  }
  log.info(`请放入封面 cover.png，以及正文引用的图片，再运行：wxpub publish ${pkgDir}`);
  return 0;
}

async function cmdCover(args) {
  const target = args._[1];
  if (!target) {
    log.fail('用法：wxpub cover <包目录> [--prompt "提示词"] [--ratio 16:9]');
    return 2;
  }
  const dir = resolve(target);
  const projectDir = resolve(args.flags.project || process.cwd());
  const { values } = loadConfig(projectDir);
  if (typeof args.flags.ratio === 'string') values.COVER_ASPECT_RATIO = args.flags.ratio;

  const articlePath = join(dir, 'article.md');
  let title = typeof args.flags.title === 'string' ? args.flags.title : '';
  let summary = '';
  if (existsSync(articlePath)) {
    const { meta } = parseFrontmatter(readFileSync(articlePath, 'utf-8'));
    title = title || meta.title || '';
    summary = meta.summary || meta.digest || '';
  }
  if (!title && typeof args.flags.prompt !== 'string') {
    log.fail('找不到标题。给 --title 或 --prompt，或先写好 article.md 的 frontmatter。');
    return 2;
  }

  log.step(`生成封面（${values.IMAGE_MODEL || 'nano-banana-2-lite'}，${values.COVER_ASPECT_RATIO || '16:9'}）`);
  const result = await generateCover({
    dir, title, summary, values,
    prompt: typeof args.flags.prompt === 'string' ? args.flags.prompt : '',
    logger: (msg) => log.info(msg),
  });
  log.ok(`封面已保存：${result.file}（${Math.round(result.bytes / 1024)} KB, ${result.type}）`);
  log.info(`来源 URL：${result.url}`);
  return 0;
}

const COVER_FILES = ['cover.png', 'cover.jpg', 'cover.jpeg'];

/** Phone-width local preview: lead cover image, body, and footer, as the draft will show them. */
function previewPage({ title, coverFile, html }) {
  const lead = coverFile
    ? `<img src="./${coverFile}" alt="" style="max-width:100%;height:auto;display:block;margin:0 auto 1em;border-radius:4px;" />\n`
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;background:#ededed;">
<div style="max-width:375px;margin:24px auto;padding:20px 16px;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;">
<h1 style="font-size:22px;line-height:1.4;margin:0 0 16px;">${title}</h1>
${lead}${html}
</div>
</body>
</html>
`;
}

async function cmdTopics(args) {
  const sources = typeof args.flags.sources === 'string'
    ? args.flags.sources.split(',').map((x) => x.trim()).filter(Boolean)
    : DEFAULT_SOURCES;
  const limit = Number(args.flags.limit || 10);
  const rss = typeof args.flags.rss === 'string' ? args.flags.rss.split(',') : [];
  log.step(`抓取热榜：${sources.join(', ')}${rss.length ? ` + ${rss.length} 个 RSS` : ''}`);
  log.info(`全部来源：${Object.keys(SOURCES).join(' | ')}`);
  const result = await gatherTopics({
    sources, limit, rss, geo: typeof args.flags.geo === 'string' ? args.flags.geo : 'US',
  });
  for (const err of result.errors) log.warn(`${err.source} 抓取失败：${err.message}`);
  log.ok(`共 ${result.items.length} 条`);

  const output = args.flags.json
    ? JSON.stringify(result, null, 2)
    : topicsToMarkdown(result, today());
  if (typeof args.flags.out === 'string') {
    const outFile = resolve(args.flags.out);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, `${output}\n`, 'utf-8');
    log.ok(`已写入 ${outFile}`);
  } else {
    log.plain(output);
  }
  return result.items.length ? 0 : 1;
}

async function cmdRender(args) {
  const target = args._[1];
  if (!target) {
    log.fail('用法：wxpub render <包目录> [--theme T] [--preview] [--out 文件]');
    return 2;
  }
  const projectDir = resolve(args.flags.project || process.cwd());
  const { values } = loadConfig(projectDir);
  const dir = resolve(target);
  const isPackage = existsSync(join(dir, 'article.md'));
  const articlePath = isPackage ? join(dir, 'article.md') : dir;
  const raw = readFileSync(articlePath, 'utf-8');
  const { meta, body } = parseFrontmatter(raw);
  const theme = typeof args.flags.theme === 'string'
    ? args.flags.theme
    : meta.theme || values.THEME || 'default';
  const html = markdownToHtml(body, { theme });

  log.info(`标题：${meta.title || '(无)'}`);
  log.info(`排版主题：${theme}（可选：${Object.keys(THEMES).join(' | ')}）`);
  log.info(`HTML ${html.length} 字符`);

  if (args.flags.preview) {
    const pkgDir = isPackage ? dir : dirname(dir);
    const coverFile = COVER_FILES.find((name) => existsSync(join(pkgDir, name)));
    const leadEnabled = boolOf(values.COVER_AS_LEAD_IMAGE, true);
    const footer = buildFooter(projectDir, values);
    const page = previewPage({
      title: meta.title || '',
      coverFile: leadEnabled ? coverFile : null,
      html: `${html}\n${footer.html}`,
    });
    const outFile = join(pkgDir, 'preview.html');
    writeFileSync(outFile, page, 'utf-8');
    log.ok(`预览页已写入 ${outFile}，用浏览器打开即可查看手机宽度效果`);
    return 0;
  }

  if (typeof args.flags.out === 'string') {
    const outFile = resolve(args.flags.out);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, html, 'utf-8');
    log.ok(`已写入 ${outFile}`);
  } else {
    log.plain(html);
  }
  return 0;
}

async function cmdPublish(args) {
  const target = args._[1];
  if (!target) {
    log.fail('用法：wxpub publish <包目录> [--mode M] [--dry-run]');
    return 2;
  }
  const projectDir = resolve(args.flags.project || process.cwd());
  const { values } = loadConfig(projectDir);
  if (typeof args.flags.mode === 'string') values.PUBLISH_MODE = args.flags.mode;

  const dryRun = Boolean(args.flags['dry-run']);
  if (!dryRun) {
    const { errors, warnings } = validateConfig(values);
    for (const warn of warnings) log.warn(warn);
    if (errors.length) {
      for (const err of errors) log.fail(err);
      log.info('先运行 wxpub doctor 补齐配置');
      return 1;
    }
  }

  if (args.flags['auto-cover']) {
    const dir = resolve(target);
    const hasCover = COVER_FILES.some((name) => existsSync(join(dir, name)));
    if (hasCover) {
      log.info('封面已存在，跳过生成');
    } else {
      const { meta } = parseFrontmatter(readFileSync(join(dir, 'article.md'), 'utf-8'));
      log.step('自动生成封面');
      const cover = await generateCover({
        dir, title: meta.title, summary: meta.summary || '', values,
        logger: (msg) => log.info(msg),
      });
      log.ok(`封面已保存：${cover.file}`);
    }
  }

  log.step(`模式 ${values.PUBLISH_MODE}${dryRun ? '（dry-run）' : ''}`);
  const result = await publish(target, values, { dryRun });
  log.plain('');
  log.ok(`状态：${result.status}`);
  if (result.media_id) log.info(`media_id：${result.media_id}`);
  if (result.status === 'draft_ready_notified') {
    log.info('请管理员到 mp 后台草稿箱手动发表。本 run 不以正式发表为成功条件。');
  }
  return result.success ? 0 : 1;
}

async function cmdNotify(args) {
  const projectDir = resolve(args.flags.project || process.cwd());
  const { values } = loadConfig(projectDir);
  const cleared = clearProxyEnv();
  if (cleared.length) log.info(`已清理代理变量：${cleared.join(', ')}`);
  const notifier = makeNotifier(values);

  const title = args.flags.title;
  const summary = args.flags.summary;
  const mediaId = args.flags['media-id'];
  if (typeof title !== 'string' || typeof summary !== 'string' || typeof mediaId !== 'string') {
    log.fail('用法：wxpub notify --draft-ready --title T --summary S --media-id M');
    return 2;
  }
  const text = buildDraftReadyText({
    account: values.WECHAT_ACCOUNT_DISPLAY_NAME,
    title, summary, mediaId, mpHome: values.WECHAT_MP_HOME_URL,
  });
  const messageId = await notifier.sendText(text, process.cwd());
  log.ok(`草稿就绪通知已发送：${messageId}`);
  return 0;
}

async function cmdPast(args) {
  const projectDir = resolve(args.flags.project || process.cwd());
  const { pastArticles } = footerFiles(projectDir);
  const action = args._[1] || 'list';
  const list = existsSync(pastArticles) ? loadPastArticles(projectDir) : [];

  if (action === 'list') {
    if (!list.length) {
      log.warn(`往期文章列表为空：${pastArticles}`);
      return 0;
    }
    list.forEach((item, i) => log.plain(`${String(i + 1).padStart(2)}. ${item.title}\n    ${item.url}`));
    log.info(`共 ${list.length} 篇`);
    return 0;
  }

  if (action === 'add') {
    const title = args.flags.title;
    const url = args.flags.url;
    if (typeof title !== 'string' || typeof url !== 'string') {
      log.fail('用法：wxpub past add --title "标题" --url https://mp.weixin.qq.com/s/xxx');
      return 2;
    }
    const next = [{ title, url }, ...list.filter((item) => item.url !== url)];
    mkdirSync(dirname(pastArticles), { recursive: true });
    writeFileSync(pastArticles, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    log.ok(`已加入往期列表，现共 ${next.length} 篇`);
    return 0;
  }

  if (action === 'remove') {
    const url = args.flags.url;
    if (typeof url !== 'string') {
      log.fail('用法：wxpub past remove --url https://mp.weixin.qq.com/s/xxx');
      return 2;
    }
    const next = list.filter((item) => item.url !== url);
    if (next.length === list.length) {
      log.warn('列表里没有这条 URL，未改动');
      return 0;
    }
    writeFileSync(pastArticles, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
    log.ok(`已移除，现共 ${next.length} 篇`);
    return 0;
  }

  log.fail(`未知子命令：past ${action}`);
  return 2;
}

async function cmdFooter(args) {
  const projectDir = resolve(args.flags.project || process.cwd());
  const { values } = loadConfig(projectDir);
  const footer = buildFooter(projectDir, values);
  if (!footer.html) {
    log.warn('文末区块为空。检查 .wxpub/footer.md 与 past-articles.json。');
    return 0;
  }
  log.info(`往期 ${footer.pastCount} 篇，自我介绍 ${footer.hasFooterMd ? '有' : '无'}，名片 ${footer.hasProfile ? '有' : '无'}`);
  if (typeof args.flags.out === 'string') {
    const outFile = resolve(args.flags.out);
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, footer.html, 'utf-8');
    log.ok(`已写入 ${outFile}`);
  } else {
    log.plain(footer.html);
  }
  return 0;
}

async function cmdSelftest() {
  const { runSelftest } = await import('../test/selftest.mjs');
  const { runCliSmoke } = await import('../test/cli-smoke.mjs');
  log.step('单元与流水线自测');
  const unit = await runSelftest();
  log.step('命令行冒烟测试');
  const cli = await runCliSmoke();
  return unit || cli;
}

// Article fields draft/update accepts; read-only batchget fields such as url and thumb_url are not sent back.
const DRAFT_ARTICLE_FIELDS = [
  'title', 'author', 'digest', 'content', 'content_source_url', 'thumb_media_id',
  'need_open_comment', 'only_fans_can_comment', 'pic_crop_235_1', 'pic_crop_1_1',
];

/**
 * Download the draft's current cover, re-upload it as permanent material, and set article.thumb_media_id.
 * thumb_url is already the 2.35:1 crop, so cover_info crops must not be applied again (53401).
 */
async function reuploadDraftCover(wx, item, article) {
  const res = await fetch(item.thumb_url);
  if (!res.ok) throw new PipelineError(`封面下载失败 HTTP ${res.status}`, { stage: 'cover_upload' });
  const file = join(mkdtempSync(join(tmpdir(), 'wxpub-cover-')), 'cover.jpg');
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  article.thumb_media_id = await wx.uploadPermanentImage(file);
}

/** Rebuild the footer block (past-article links and so on) of every draft from the current configuration. */
async function refreshDraftFooters(wx, projectDir, values, { ids, dryRun }) {
  const footer = buildFooter(projectDir, values);
  if (!footer.html) {
    log.fail('当前配置不生成文末区块，无可替换内容');
    return 2;
  }
  const drafts = await wx.listDrafts();
  let updated = 0;
  let failed = 0;
  for (const draft of drafts) {
    if (ids.length && !ids.includes(draft.media_id)) continue;
    for (const [index, item] of draft.content.news_item.entries()) {
      const content = replaceFooter(item.content, footer.html);
      if (content === null) continue;
      if (content === item.content) {
        log.info(`无变化：${item.title}`);
        continue;
      }
      if (dryRun) {
        log.info(`将更新：${item.title}（${draft.media_id}#${index}）`);
        updated += 1;
        continue;
      }
      const article = Object.fromEntries(
        DRAFT_ARTICLE_FIELDS.filter((key) => key in item).map((key) => [key, item[key]]),
      );
      try {
        if (!article.thumb_media_id && item.thumb_url) {
          // Drafts whose cover was changed in the web editor only expose thumb_url; draft/update without it fails with 40007.
          await reuploadDraftCover(wx, item, article);
        }
        await wx.updateDraft(draft.media_id, index, { ...article, content });
        updated += 1;
        log.ok(`已更新：${item.title}`);
      } catch (err) {
        failed += 1;
        log.fail(`更新失败 ${item.title}：${err.message}`);
      }
    }
  }
  log.ok(`${dryRun ? '将更新' : '已更新'} ${updated} 篇，失败 ${failed} 篇`);
  return failed ? 1 : 0;
}

async function cmdDraft(args) {
  const sub = args._[1];
  const ids = args._.slice(2);
  const projectDir = resolve(args.flags.project || process.cwd());
  const { values } = loadConfig(projectDir);
  const wx = new WechatClient({
    appId: values.WECHAT_APP_ID,
    appSecret: values.WECHAT_APP_SECRET,
    apiBase: values.WECHAT_API_BASE,
    logger: (msg) => log.info(msg),
  });
  if (sub === 'refresh-footer') {
    return refreshDraftFooters(wx, projectDir, values, { ids, dryRun: Boolean(args.flags['dry-run']) });
  }
  if (sub !== 'delete' || ids.length === 0) {
    log.fail('用法：wxpub draft delete <media_id> [<media_id> ...] | wxpub draft refresh-footer [<media_id> ...] [--dry-run]');
    return 2;
  }
  let failed = 0;
  for (const id of ids) {
    try {
      await wx.deleteDraft(id);
      log.ok(`已删除草稿 ${id}`);
    } catch (err) {
      failed += 1;
      log.fail(`删除失败 ${id}：${err.message}`);
    }
  }
  return failed ? 1 : 0;
}

const COMMANDS = {
  topics: cmdTopics,
  init: cmdInit,
  doctor: cmdDoctor,
  new: cmdNew,
  cover: cmdCover,
  render: cmdRender,
  publish: cmdPublish,
  notify: cmdNotify,
  past: cmdPast,
  draft: cmdDraft,
  footer: cmdFooter,
  selftest: cmdSelftest,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.flags.help) {
    usage();
    return command ? 0 : 2;
  }
  const handler = COMMANDS[command];
  if (!handler) {
    log.fail(`未知命令：${command}`);
    usage();
    return 2;
  }
  try {
    return await handler(args);
  } catch (err) {
    if (err instanceof PipelineError) {
      log.fail(`[${err.stage}] ${err.message}`);
    } else {
      log.fail(err.stack || err.message);
    }
    return 1;
  }
}

// 顶层未捕获异常也要给出非 0 退出码，cron 才能告警
main().then((code) => { process.exitCode = code; }).catch((err) => {
  log.fail(err.stack || String(err));
  process.exitCode = 1;
});

export { parseArgs };
