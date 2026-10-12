/**
 * 文末固定区块：往期文章精选 + 自我介绍 + 公众号名片。
 *
 * 数据来源（都在项目目录，不进 skill 包）：
 *   .wxpub/footer.md          任意 Markdown，如「one more thing」与自我介绍
 *   .wxpub/past-articles.json [{ "title": "...", "url": "https://mp.weixin.qq.com/s/..." }]
 *
 * 名片说明：微信原生 <mp-common-profile> 是后台编辑器控件，
 * 经 draft/add 提交常被过滤。默认渲染等效 HTML 名片卡，一定存活；
 * 原生组件用 PROFILE_CARD_NATIVE=true 额外附加。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boolOf } from './config.mjs';
import { markdownToHtml } from './markdown.mjs';
import { PipelineError } from './util.mjs';

// 文末区块统一用最小字号，和正文（16px）拉开层级。
const FOOTER_FONT_SIZE = '12px';

/** 把一段 HTML 里的字号压到文末区块的最小字号。 */
function shrinkFontSize(html) {
  return html.replace(/font-size:\s*\d+(?:\.\d+)?px/g, `font-size:${FOOTER_FONT_SIZE}`);
}

const S = {
  divider: 'margin:2em 0 1.2em;border:none;border-top:1px solid #e5e5e5;',
  sectionTitle: `margin:1.5em 0 0.8em;font-size:${FOOTER_FONT_SIZE};font-weight:bold;color:#333;`,
  list: 'margin:0;padding:0;list-style:none;',
  item: `margin-bottom:0.6em;line-height:1.6;font-size:${FOOTER_FONT_SIZE};`,
  link: 'color:#576b95;text-decoration:none;',
  card: 'margin:1.5em 0;padding:14px 16px;border:1px solid #e8e8e8;border-radius:8px;background:#fafafa;',
  cardRow: 'display:flex;align-items:center;',
  avatar: 'width:48px;height:48px;border-radius:50%;margin-right:12px;flex-shrink:0;',
  nickname: 'font-size:16px;font-weight:bold;color:#333;margin:0 0 4px;line-height:1.4;',
  signature: 'font-size:13px;color:#888;margin:0;line-height:1.5;',
  cardTag: `margin:10px 0 0;font-size:${FOOTER_FONT_SIZE};color:#aaa;`,
};

export function footerFiles(projectDir) {
  return {
    footerMd: join(projectDir, '.wxpub', 'footer.md'),
    pastArticles: join(projectDir, '.wxpub', 'past-articles.json'),
  };
}

/** 读往期文章列表。文件不存在返回空数组，不报错。 */
export function loadPastArticles(projectDir) {
  const { pastArticles } = footerFiles(projectDir);
  if (!existsSync(pastArticles)) return [];
  const raw = JSON.parse(readFileSync(pastArticles, 'utf-8'));
  const list = Array.isArray(raw) ? raw : raw.articles || [];
  return list.filter((item) => item && item.title);
}

/**
 * 校验往期文章链接。
 *
 * 实测 2026-09-19，三种链接分别提交 draft/add：
 *   mp.weixin.qq.com/s?__biz=..&mid=..&idx=..&sn=..  长链接  通过
 *   mp.weixin.qq.com/s/<ID>                          短链接  45166 invalid content
 *   其他域名的普通外链                                        通过
 * 结论：决定成败的是链接格式，不是链接真假。公众号文章一律用长链接。
 * 短链接可以在浏览器里打开原文，从地址栏或页面 canonical 拿到长链接。
 */
export function validatePastArticles(articles, linkMode = 'text') {
  const problems = [];
  if (linkMode !== 'link') return problems;
  for (const item of articles) {
    const url = String(item.url || '');
    if (!url) continue;
    if (url.includes('fill_in')) {
      problems.push(`占位链接未替换：「${item.title}」-> ${url}`);
      continue;
    }
    if (!/^https?:\/\//i.test(url)) {
      problems.push(`不是合法 URL：「${item.title}」-> ${url}`);
      continue;
    }
    if (/mp\.weixin\.qq\.com\/s\//i.test(url)) {
      problems.push(
        `公众号短链接会被 draft/add 拒绝（45166）：「${item.title}」-> ${url}。` +
        '换成 mp.weixin.qq.com/s?__biz=..&mid=..&idx=..&sn=.. 的长链接。',
      );
    }
  }
  return problems;
}

/**
 * 「往期文章精选」区块。
 *
 * linkMode:
 *   text  纯文字标题，不带链接。
 *   link  带 <a>。公众号文章用长链接，短链接会被 draft/add 拒绝（45166）。
 */
export function renderPastArticles(articles, {
  limit = 15, title = '往期文章精选：', linkMode = 'text', hint = '',
} = {}) {
  const picked = articles.slice(0, limit);
  if (!picked.length) return '';
  const items = picked.map((item) => {
    const label = linkMode === 'link' && item.url
      ? `<a href="${item.url}" style="${S.link}">${item.title}</a>`
      : item.title;
    return `<li style="${S.item}">${label}</li>`;
  }).join('');
  const hintLine = hint ? `<p style="${S.cardTag}">${hint}</p>` : '';
  return `<p style="${S.sectionTitle}">${title}</p>\n<ul style="${S.list}">${items}</ul>${hintLine}`;
}

/** 公众号名片卡：等效 HTML，经 API 提交不会被过滤。 */
export function renderProfileCard({ nickname, signature, headimg, alias, native, nativeId }) {
  if (!nickname) return '';

  // 实测：draft/add 保留 mp-common-profile，后台打开就是真名片。
  // 有 data-id 时优先用它，别再叠一张等效 HTML 卡。
  if (nativeId) {
    return `<mp-common-profile class="js_uneditable custom_select_card mp_common_widget" ` +
      `data-pluginname="mpprofile" data-id="${nativeId}" data-nickname="${nickname}" ` +
      `data-alias="${alias || ''}" data-signature="${signature || ''}" ` +
      `data-headimg="${headimg || ''}" data-from="0"></mp-common-profile>`;
  }

  const avatar = headimg
    ? `<img src="${headimg}" alt="${nickname}" style="${S.avatar}" />`
    : '';
  const aliasLine = alias ? `<p style="${S.cardTag}">微信号：${alias}</p>` : '';
  const html = [
    `<section style="${S.card}">`,
    `<section style="${S.cardRow}">`,
    avatar,
    '<section>',
    `<p style="${S.nickname}">${nickname}</p>`,
    signature ? `<p style="${S.signature}">${signature}</p>` : '',
    '</section>',
    '</section>',
    aliasLine,
    `<p style="${S.cardTag}">点击上方名称关注，第一时间看到更新。</p>`,
    '</section>',
  ].filter(Boolean).join('\n');

  return html;
}

/**
 * Swap the footer block of already-rendered content for `footerHtml`.
 * The footer starts at the <hr> styled with S.divider and runs to the end; returns null if absent.
 */
export function replaceFooter(content, footerHtml) {
  const start = content.lastIndexOf(`<hr style="${S.divider}"`);
  if (start < 0) return null;
  return `${content.slice(0, start).trimEnd()}\n${footerHtml}`;
}

/**
 * 组装整个文末区块。
 * @returns {{ html: string, pastCount: number, hasFooterMd: boolean, hasProfile: boolean }}
 */
export function buildFooter(projectDir, values = {}) {
  if (!boolOf(values.ARTICLE_FOOTER_ENABLED, true)) {
    return { html: '', pastCount: 0, hasFooterMd: false, hasProfile: false };
  }

  const parts = [];
  const { footerMd } = footerFiles(projectDir);
  const hasFooterMd = existsSync(footerMd);
  if (hasFooterMd) {
    const text = readFileSync(footerMd, 'utf-8').trim();
    if (text) parts.push(shrinkFontSize(markdownToHtml(text)));
  }

  const articles = loadPastArticles(projectDir);
  const linkMode = values.PAST_ARTICLES_LINK_MODE || 'text';
  const linkProblems = validatePastArticles(articles, linkMode);
  if (linkProblems.length) {
    throw new PipelineError(
      `往期文章链接不可用：\n  - ${linkProblems.join('\n  - ')}`,
      { stage: 'footer' },
    );
  }
  const pastBlock = renderPastArticles(articles, {
    limit: Number(values.PAST_ARTICLES_LIMIT || 15),
    title: values.PAST_ARTICLES_TITLE || '往期文章精选：',
    linkMode,
    hint: linkMode === 'text'
      ? (values.PAST_ARTICLES_HINT || '以上文章可在本公众号内搜索标题查看。')
      : '',
  });
  if (pastBlock) parts.push(pastBlock);

  const profile = renderProfileCard({
    nickname: values.PROFILE_NICKNAME || values.WECHAT_ACCOUNT_DISPLAY_NAME,
    signature: values.PROFILE_SIGNATURE,
    headimg: values.PROFILE_HEADIMG,
    alias: values.PROFILE_ALIAS,
    nativeId: boolOf(values.PROFILE_CARD_NATIVE, true) ? values.PROFILE_CARD_ID : '',
  });
  if (profile && boolOf(values.PROFILE_CARD_ENABLED, true)) parts.push(profile);

  if (!parts.length) {
    return { html: '', pastCount: 0, hasFooterMd, hasProfile: false };
  }

  return {
    html: `<hr style="${S.divider}" />\n${parts.join('\n')}`,
    pastCount: Math.min(articles.length, Number(values.PAST_ARTICLES_LIMIT || 15)),
    hasFooterMd,
    hasProfile: Boolean(profile),
  };
}
