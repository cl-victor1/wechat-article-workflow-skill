/**
 * Markdown -> 微信正文 HTML。
 *
 * 微信编辑器不接受 <style> 与 class，只认内联样式，故全部内联。
 * 转换范围刻意保守：标题、段落、粗斜体、列表、引用、代码、图片、链接、分隔线。
 */

/**
 * Layout themes. A theme changes only the accent color and the second-level heading style;
 * body size and line height stay the same so every theme reads well on a phone.
 * Add a theme by adding one entry here.
 */
export const THEMES = {
  default: { accent: '#1e90ff', h2: 'bar', label: '蓝色左边框（默认）' },
  green: { accent: '#07c160', h2: 'bar', label: '微信绿左边框' },
  orange: { accent: '#ff6a00', h2: 'underline', label: '橙色下划线' },
  ink: { accent: '#333333', h2: 'center', label: '黑白居中，适合长文与随笔' },
};

function h2Style(theme) {
  const base = 'font-size:18px;font-weight:bold;line-height:1.5;';
  if (theme.h2 === 'underline') {
    return `margin:1.6em 0 0.6em;${base}padding-bottom:6px;border-bottom:2px solid ${theme.accent};`;
  }
  if (theme.h2 === 'center') {
    return `margin:1.8em 0 0.8em;${base}text-align:center;color:${theme.accent};letter-spacing:1px;`;
  }
  return `margin:1.5em 0 0.5em;${base}border-left:4px solid ${theme.accent};padding-left:10px;`;
}

/** Builds the inline style table for a theme. Unknown names throw instead of silently using the default. */
export function themeStyles(name = 'default') {
  const theme = THEMES[name];
  if (!theme) {
    throw new Error(`未知排版主题：${name}。可选：${Object.keys(THEMES).join(' | ')}`);
  }
  return {
    h1: 'margin:1.2em 0 0.6em;font-size:22px;font-weight:bold;line-height:1.4;',
    h2: h2Style(theme),
    h3: `margin:1.2em 0 0.5em;font-size:16px;font-weight:bold;color:${theme.accent};`,
    h4: 'margin:1em 0 0.4em;font-size:15px;font-weight:bold;',
    p: 'margin-bottom:1em;line-height:1.8;font-size:16px;color:#333;',
    ul: 'margin:0.8em 0;padding-left:1.4em;',
    ol: 'margin:0.8em 0;padding-left:1.4em;',
    li: 'margin-bottom:0.4em;line-height:1.8;font-size:16px;color:#333;',
    quote: `margin:1em 0;padding:0.6em 1em;border-left:3px solid ${theme.accent};background:#fafafa;color:#666;line-height:1.8;`,
    pre: 'margin:1em 0;padding:1em;background:#f6f8fa;border-radius:4px;overflow-x:auto;font-size:14px;line-height:1.6;',
    code: 'padding:2px 5px;background:#f2f2f2;border-radius:3px;font-size:14px;color:#c7254e;',
    strong: `color:${theme.accent};`,
    img: 'max-width:100%;height:auto;display:block;margin:1em auto;border-radius:4px;',
    hr: 'margin:1.5em 0;border:none;border-top:1px solid #e5e5e5;',
    a: 'color:#576b95;text-decoration:none;',
  };
}

/**
 * 去掉 HTML 注释。
 *
 * 微信正文不认注释，不剥的话 `<!--` 和注释内容会被当成普通段落原样发出去；
 * 注释里的 ![](./x.jpg) 也会被误当成必须存在的正文图。
 * 围栏代码块里的注释是要展示的内容，原样保留。
 */
export function stripHtmlComments(md) {
  const text = String(md).replace(/\r\n/g, '\n');
  // 奇数段是围栏代码块，跳过不处理
  return text
    .split(/(^```[\s\S]*?^```[ \t]*$)/m)
    .map((part, idx) => (idx % 2 === 1 ? part : part.replace(/<!--[\s\S]*?-->/g, '')))
    .join('');
}

/** 解析 --- 包裹的 YAML frontmatter，仅支持一层 key: value。 */
export function parseFrontmatter(md) {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: md };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[key] = val;
  }
  return { meta, body: match[2] };
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const CODE_SLOT = 'WXPUBCODESLOT';

/** 行内元素：代码 -> 图片 -> 链接 -> 粗体 -> 斜体。顺序不可换。 */
function inline(text, S) {
  let out = text;
  const slots = [];
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    slots.push('<code style="' + S.code + '">' + escapeHtml(code) + '</code>');
    return CODE_SLOT + (slots.length - 1) + 'END';
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
    (_, alt, src) => '<img src="' + src + '" alt="' + alt + '" style="' + S.img + '" />');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
    (_, label, href) => '<a href="' + href + '" style="' + S.a + '">' + label + '</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong style="' + S.strong + '">$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(new RegExp(CODE_SLOT + '(\\d+)END', 'g'), (_, i) => slots[Number(i)]);
  return out;
}

/** 块级转换。返回可直接放进 draft/add 的 content。 */
export function markdownToHtml(md, { theme = 'default' } = {}) {
  const S = themeStyles(theme);
  const lines = stripHtmlComments(md).split('\n');
  const out = [];
  let i = 0;
  let listBuffer = null;

  const flushList = () => {
    if (!listBuffer) return;
    const tag = listBuffer.ordered ? 'ol' : 'ul';
    const style = listBuffer.ordered ? S.ol : S.ul;
    const items = listBuffer.items
      .map((item) => '<li style="' + S.li + '">' + inline(item, S) + '</li>').join('');
    out.push('<' + tag + ' style="' + style + '">' + items + '</' + tag + '>');
    listBuffer = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      flushList();
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push('<pre style="' + S.pre + '"><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
      continue;
    }

    if (!trimmed) {
      flushList();
      i += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length, 4);
      const style = [S.h1, S.h2, S.h3, S.h4][level - 1];
      out.push('<h' + level + ' style="' + style + '">' + inline(heading[2], S) + '</h' + level + '>');
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      out.push('<hr style="' + S.hr + '" />');
      i += 1;
      continue;
    }

    if (trimmed.startsWith('>')) {
      flushList();
      const quote = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      out.push('<blockquote style="' + S.quote + '">' + inline(quote.join(' '), S) + '</blockquote>');
      continue;
    }

    const ordered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ordered || unordered) {
      const isOrdered = Boolean(ordered);
      const text = isOrdered ? ordered[2] : unordered[1];
      if (!listBuffer || listBuffer.ordered !== isOrdered) {
        flushList();
        listBuffer = { ordered: isOrdered, items: [] };
      }
      listBuffer.items.push(text);
      i += 1;
      continue;
    }

    flushList();
    const rendered = inline(trimmed, S);
    if (/^<img\b[^>]*\/>$/.test(rendered)) {
      out.push(rendered);
    } else {
      out.push('<p style="' + S.p + '">' + rendered + '</p>');
    }
    i += 1;
  }

  flushList();
  return out.join('\n');
}

/** 取出正文引用的本地图片相对路径，排除 http 与 data URI。 */
export function collectLocalImages(body) {
  const found = new Set();
  const clean = stripHtmlComments(body);
  const re = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
  let match;
  while ((match = re.exec(clean)) !== null) {
    const src = match[1];
    if (/^https?:\/\//i.test(src) || src.startsWith('data:')) continue;
    found.add(src.replace(/^\.\//, ''));
  }
  return [...found];
}

/** 从正文推一句摘要：首个非标题段落，截断到 limit 字。 */
export function deriveSummary(body, limit = 120) {
  for (const rawLine of stripHtmlComments(body).split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('!') ||
        line.startsWith('>') || line.startsWith('```')) continue;
    const plain = line
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*`>#-]/g, '')
      .trim();
    if (plain) return plain.slice(0, limit);
  }
  return '';
}
