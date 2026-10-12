/**
 * 草稿后置设置：原创声明、赞赏、合集、智能插入广告。
 *
 * 重要事实：微信 draft/add 接口不提供这四项字段。官方 articles 只支持
 * title / author / digest / content / content_source_url / thumb_media_id /
 * need_open_comment / only_fans_can_comment / cover_info / article_type / product_info。
 *
 * 所以流水线做两件事：
 *   1. 把 API 能设的项（评论开关、作者、来源链接）直接写进草稿
 *   2. 为这四项生成待办清单，并按正文内容自动选好合集名，交给后台或通道 B
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boolOf } from './config.mjs';

export function collectionsFile(projectDir) {
  return join(projectDir, '.wxpub', 'collections.json');
}

/**
 * 读合集规则。格式：
 * [{ "name": "AI", "keywords": ["AI", "模型", "Claude"], "default": true }]
 */
export function loadCollectionRules(projectDir) {
  const file = collectionsFile(projectDir);
  if (!existsSync(file)) return [];
  const raw = JSON.parse(readFileSync(file, 'utf-8'));
  const list = Array.isArray(raw) ? raw : raw.collections || [];
  return list.filter((item) => item && item.name);
}

/**
 * 按标题与正文选合集。标题命中权重 3 倍。
 * @returns {{ name: string|null, hits: number, reason: string }}
 */
export function pickCollection({ title = '', body = '', rules = [], override = '' }) {
  if (override) return { name: override, hits: 0, reason: 'frontmatter 指定' };
  if (!rules.length) return { name: null, hits: 0, reason: '未配置 collections.json' };

  const haystackTitle = title.toLowerCase();
  const haystackBody = body.toLowerCase();
  let best = { name: null, hits: 0, reason: '' };

  for (const rule of rules) {
    let hits = 0;
    const matched = [];
    for (const keyword of rule.keywords || []) {
      const needle = String(keyword).toLowerCase();
      if (!needle) continue;
      const inTitle = haystackTitle.includes(needle);
      const bodyCount = haystackBody.split(needle).length - 1;
      if (inTitle) {
        hits += 3;
        matched.push(keyword);
      }
      if (bodyCount > 0) {
        hits += Math.min(bodyCount, 3);
        if (!inTitle) matched.push(keyword);
      }
    }
    if (hits > best.hits) {
      best = { name: rule.name, hits, reason: `命中关键词：${matched.join('、')}` };
    }
  }

  if (best.name) return best;
  const fallback = rules.find((rule) => rule.default) || rules[0];
  return { name: fallback.name, hits: 0, reason: '无关键词命中，用默认合集' };
}

/**
 * 生成后台待办清单。
 * @returns {{ items: Array<{key:string,label:string,value:string,api:boolean}>, collection: object }}
 */
export function buildPostDraftSettings({ title, body, values, meta = {} }) {
  const projectDir = values.projectDir || process.cwd();
  const rules = loadCollectionRules(projectDir);
  const collection = pickCollection({
    title, body, rules, override: meta.collection || '',
  });

  const author = meta.author || values.WECHAT_AUTHOR || values.WECHAT_ACCOUNT_DISPLAY_NAME || '';
  const items = [];

  if (boolOf(values.ORIGINAL_DECLARE, true)) {
    items.push({
      key: 'original',
      label: '原创声明',
      value: `开启，作者：${author || '（请填）'}；允许快捷转载`,
      api: false,
    });
  }
  if (boolOf(values.REWARD_ENABLED, true)) {
    items.push({
      key: 'reward',
      label: '赞赏',
      value: `开启，收款账户：${values.REWARD_ACCOUNT || author || '（请选）'}`,
      api: false,
    });
  }
  if (boolOf(values.COLLECTION_ENABLED, true)) {
    items.push({
      key: 'collection',
      label: '合集',
      value: collection.name ? `${collection.name}（${collection.reason}）` : '（未配置 collections.json）',
      api: false,
    });
  }
  if (boolOf(values.SMART_AD_ENABLED, true)) {
    items.push({
      key: 'advertisement',
      label: '智能插入广告',
      value: `开启，最多 ${values.SMART_AD_MAX_INSERTIONS || 2} 条`,
      api: false,
    });
  }

  return { items, collection };
}

/** 待办清单转飞书/终端文本。 */
export function renderPostDraftText(items) {
  if (!items.length) return '';
  const lines = items.map((item, i) => `${i + 1}. ${item.label}：${item.value}`);
  return [
    '后台还需手动设置（API 不支持这几项）：',
    ...lines,
  ].join('\n');
}
