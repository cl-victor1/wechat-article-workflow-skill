/**
 * Topic radar: pulls today's trending lists from public sources to pick an article topic.
 *
 * Every source is a public endpoint or feed that needs no login. A failing source records
 * one error and does not stop the others, because trending endpoints change or rate-limit
 * without notice.
 *
 * Each item is { source, title, url, heat }; heat may be empty.
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function decodeEntities(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return match ? decodeEntities(match[1]) : '';
}

/** Parses RSS 2.0 <item> and Atom <entry> blocks; keeps the title and the link only. */
export function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/g)
    || xml.match(/<entry[\s>][\s\S]*?<\/entry>/g)
    || [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    let url = tagText(block, 'link');
    if (!url) {
      const href = block.match(/<link[^>]*href="([^"]+)"/);
      url = href ? decodeEntities(href[1]) : '';
    }
    const traffic = tagText(block, 'ht:approx_traffic');
    if (title) items.push({ title, url, heat: traffic || '' });
  }
  return items;
}

async function getText(fetchImpl, url) {
  const resp = await fetchImpl(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

async function getJson(fetchImpl, url) {
  return JSON.parse(await getText(fetchImpl, url));
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/** Source registry. The key is the source name used on the command line. */
export const SOURCES = {
  zhihu: {
    label: '知乎热榜',
    async fetch(fetchImpl, limit) {
      const data = await getJson(fetchImpl, `https://api.zhihu.com/topstory/hot-lists/total?limit=${limit}`);
      return (data.data || []).map((row) => ({
        title: row.target?.title || '',
        // The id exceeds 2^53 and loses precision in JSON.parse, so read it from the url string
        url: String(row.target?.url || '').replace('api.zhihu.com/questions/', 'www.zhihu.com/question/'),
        heat: row.detail_text || '',
      }));
    },
  },
  baidu: {
    label: '百度热搜',
    async fetch(fetchImpl) {
      const data = await getJson(fetchImpl, 'https://top.baidu.com/api/board?platform=wise&tab=realtime');
      const card = (data.data?.cards || [])[0] || {};
      const rows = (card.content || []).flatMap((group) => group.content || [group]);
      return rows.map((row) => ({
        title: row.word || row.query || '',
        url: row.url || row.rawUrl || '',
        heat: row.hotScore ? String(row.hotScore) : '',
      }));
    },
  },
  v2ex: {
    label: 'V2EX 最热',
    async fetch(fetchImpl) {
      const data = await getJson(fetchImpl, 'https://www.v2ex.com/api/topics/hot.json');
      return data.map((row) => ({
        title: row.title || '',
        url: row.url || '',
        heat: row.replies ? `${row.replies} 回复` : '',
      }));
    },
  },
  sspai: {
    label: '少数派',
    async fetch(fetchImpl) {
      return parseFeed(await getText(fetchImpl, 'https://sspai.com/feed'));
    },
  },
  hackernews: {
    label: 'Hacker News',
    async fetch(fetchImpl, limit) {
      const ids = await getJson(fetchImpl, 'https://hacker-news.firebaseio.com/v0/topstories.json');
      const rows = await Promise.all(ids.slice(0, limit).map((id) => getJson(
        fetchImpl, `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
      )));
      return rows.filter(Boolean).map((row) => ({
        title: row.title || '',
        url: row.url || `https://news.ycombinator.com/item?id=${row.id}`,
        heat: row.score ? `${row.score} points` : '',
      }));
    },
  },
  github: {
    label: 'GitHub 近 7 天新星项目',
    async fetch(fetchImpl, limit) {
      const query = encodeURIComponent(`created:>${isoDaysAgo(7)}`);
      const data = await getJson(
        fetchImpl,
        `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=${limit}`,
      );
      return (data.items || []).map((row) => ({
        title: `${row.full_name}：${row.description || ''}`.replace(/：$/, ''),
        url: row.html_url || '',
        heat: `${row.stargazers_count} stars`,
      }));
    },
  },
  producthunt: {
    label: 'Product Hunt',
    async fetch(fetchImpl) {
      return parseFeed(await getText(fetchImpl, 'https://www.producthunt.com/feed'));
    },
  },
  'google-trends': {
    label: 'Google Trends',
    async fetch(fetchImpl, _limit, opts) {
      const geo = opts.geo || 'US';
      const rows = parseFeed(await getText(fetchImpl, `https://trends.google.com/trending/rss?geo=${geo}`));
      // The item <link> points back at the feed itself; link to a search for the term instead
      return rows.map((row) => ({
        ...row, url: `https://www.google.com/search?q=${encodeURIComponent(row.title)}`,
      }));
    },
  },
};

export const DEFAULT_SOURCES = ['zhihu', 'baidu', 'v2ex', 'sspai', 'hackernews', 'github'];

/**
 * Fetches trending items from the chosen sources.
 * @param {object} opts { sources, limit, geo, rss: [url], fetchImpl }
 * @returns {{ items: object[], errors: object[] }}
 */
export async function gatherTopics({
  sources = DEFAULT_SOURCES, limit = 10, geo = 'US', rss = [], fetchImpl = fetch,
} = {}) {
  const unknown = sources.filter((name) => !SOURCES[name]);
  if (unknown.length) {
    throw new Error(`未知来源：${unknown.join(', ')}。可选：${Object.keys(SOURCES).join(' | ')}`);
  }

  const jobs = sources.map((name) => ({
    name,
    label: SOURCES[name].label,
    run: () => SOURCES[name].fetch(fetchImpl, limit, { geo }),
  }));
  for (const url of rss) {
    jobs.push({
      name: 'rss', label: url, run: async () => parseFeed(await getText(fetchImpl, url)),
    });
  }

  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const items = [];
  const errors = [];
  settled.forEach((result, idx) => {
    const job = jobs[idx];
    if (result.status === 'rejected') {
      errors.push({ source: job.label, message: result.reason?.message || String(result.reason) });
      return;
    }
    const rows = result.value.filter((row) => row.title).slice(0, limit);
    for (const row of rows) items.push({ source: job.label, ...row });
  });
  return { items, errors };
}

/** Renders the result as Markdown grouped by source, ready to paste into topic notes. */
export function topicsToMarkdown({ items, errors }, date) {
  const lines = [`# 选题雷达 ${date}`, ''];
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.source)) groups.set(item.source, []);
    groups.get(item.source).push(item);
  }
  for (const [source, rows] of groups) {
    lines.push(`## ${source}`, '');
    rows.forEach((row, idx) => {
      const title = row.url ? `[${row.title}](${row.url})` : row.title;
      lines.push(`${idx + 1}. ${title}${row.heat ? `（${row.heat}）` : ''}`);
    });
    lines.push('');
  }
  if (errors.length) {
    lines.push('## 抓取失败', '');
    for (const err of errors) lines.push(`- ${err.source}：${err.message}`);
    lines.push('');
  }
  return lines.join('\n');
}
