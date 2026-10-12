/**
 * 配置加载与校验。
 *
 * 优先级（后者覆盖前者）：
 *   1. ~/.wxpub/.env（全局，多个项目共用）
 *   2. <project-dir>/.wxpub/.env
 *   3. 进程环境变量
 *
 * 真实密钥只存在于目标环境的 .env 或进程环境，永不进本仓库。
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { mask } from './util.mjs';

export const PUBLISH_MODES = [
  'draft_notify_feishu',
  'draft_only',
  'api_freepublish',
];

const DEFAULTS = {
  PUBLISH_MODE: 'draft_only',
  WECHAT_MP_HOME_URL: 'https://mp.weixin.qq.com/',
  WECHAT_API_BASE: 'https://api.weixin.qq.com',
  FEISHU_API_BASE: 'https://open.feishu.cn',
  FEISHU_DRIVER: 'api',
  FEISHU_DRAFT_NOTIFY_ENABLED: 'true',
  COVER_AS_LEAD_IMAGE: 'true',
  ARTICLE_FOOTER_ENABLED: 'true',
  PAST_ARTICLES_LIMIT: '15',
  PAST_ARTICLES_TITLE: '往期文章精选：',
  PROFILE_CARD_ENABLED: 'true',
  PROFILE_CARD_NATIVE: 'true',
  PAST_ARTICLES_LINK_MODE: 'text',
  NEED_OPEN_COMMENT: 'true',
  ONLY_FANS_CAN_COMMENT: 'false',
  ORIGINAL_DECLARE: 'true',
  REWARD_ENABLED: 'true',
  COLLECTION_ENABLED: 'true',
  SMART_AD_ENABLED: 'true',
  SMART_AD_MAX_INSERTIONS: '2',
  IMAGE_MODEL: 'nano-banana-2-lite',
  KIE_BASE_URL: 'https://api.kie.ai',
  COVER_ASPECT_RATIO: '16:9',
  THEME: 'default',
};

export const KNOWN_KEYS = [
  'WECHAT_APP_ID',
  'WECHAT_APP_SECRET',
  'WECHAT_ACCOUNT_DISPLAY_NAME',
  'WECHAT_ACCOUNT_SLUG',
  'WECHAT_AUTHOR',
  'WECHAT_MP_HOME_URL',
  'WECHAT_API_BASE',
  'PUBLISH_MODE',
  'FEISHU_DRIVER',
  'FEISHU_API_BASE',
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_NOTIFY_OPEN_ID',
  'FEISHU_NOTIFY_CHAT_ID',
  'FEISHU_DRAFT_NOTIFY_ENABLED',
  'COVER_AS_LEAD_IMAGE',
  'ARTICLE_FOOTER_ENABLED',
  'PAST_ARTICLES_LIMIT',
  'PAST_ARTICLES_TITLE',
  'PAST_ARTICLES_LINK_MODE',
  'PAST_ARTICLES_HINT',
  'PROFILE_CARD_ENABLED',
  'PROFILE_CARD_NATIVE',
  'PROFILE_CARD_ID',
  'PROFILE_NICKNAME',
  'PROFILE_ALIAS',
  'PROFILE_SIGNATURE',
  'PROFILE_HEADIMG',
  'NEED_OPEN_COMMENT',
  'ONLY_FANS_CAN_COMMENT',
  'ORIGINAL_DECLARE',
  'REWARD_ENABLED',
  'REWARD_ACCOUNT',
  'COLLECTION_ENABLED',
  'SMART_AD_ENABLED',
  'SMART_AD_MAX_INSERTIONS',
  'KIE_API_KEY',
  'KIE_BASE_URL',
  'IMAGE_MODEL',
  'COVER_ASPECT_RATIO',
  'COVER_PROMPT_STYLE',
  'COVER_POLL_ATTEMPTS',
  'COVER_POLL_INTERVAL_MS',
  'THEME',
];

/** 解析 KEY=VALUE 文本，忽略注释与空行，去掉包裹引号。 */
export function parseEnvText(content) {
  const env = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

export function envFileCandidates(projectDir) {
  return [
    join(homedir(), '.wxpub', '.env'),
    join(resolve(projectDir), '.wxpub', '.env'),
  ];
}

/** 加载配置。返回 { values, sources, loadedFiles }。 */
export function loadConfig(projectDir = process.cwd()) {
  const values = { ...DEFAULTS };
  const sources = {};
  for (const key of Object.keys(DEFAULTS)) sources[key] = 'default';

  const loadedFiles = [];
  for (const file of envFileCandidates(projectDir)) {
    if (!existsSync(file)) continue;
    loadedFiles.push(file);
    const parsed = parseEnvText(readFileSync(file, 'utf-8'));
    for (const [key, val] of Object.entries(parsed)) {
      if (val === '' || val.startsWith('fill_in_')) continue;
      values[key] = val;
      sources[key] = file;
    }
  }

  const known = new Set([...Object.keys(DEFAULTS), ...KNOWN_KEYS]);
  for (const key of known) {
    const fromProcess = process.env[key];
    if (fromProcess && !fromProcess.startsWith('fill_in_')) {
      values[key] = fromProcess;
      sources[key] = 'process-env';
    }
  }

  values.projectDir = resolve(projectDir);
  return { values, sources, loadedFiles };
}

const SECRET_KEYS = new Set([
  'WECHAT_APP_SECRET', 'FEISHU_APP_SECRET', 'KIE_API_KEY',
]);

export function isSecret(key) {
  return SECRET_KEYS.has(key);
}

export function displayValue(key, value) {
  if (!value) return '(未配置)';
  return isSecret(key) ? mask(value) : value;
}

export function boolOf(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * 按当前模式校验配置。返回 { errors, warnings }。
 * errors 非空表示不能发布。
 */
export function validateConfig(values) {
  const errors = [];
  const warnings = [];

  const mode = values.PUBLISH_MODE;

  if (!PUBLISH_MODES.includes(mode)) {
    errors.push(`PUBLISH_MODE 非法：${mode}。合法值：${PUBLISH_MODES.join(' | ')}`);
  }

  const needsApi = ['draft_notify_feishu', 'draft_only', 'api_freepublish'].includes(mode);
  if (needsApi) {
    if (!values.WECHAT_APP_ID) errors.push('缺少 WECHAT_APP_ID');
    if (!values.WECHAT_APP_SECRET) errors.push('缺少 WECHAT_APP_SECRET');
  }

  const draftNotify = mode === 'draft_notify_feishu' &&
    boolOf(values.FEISHU_DRAFT_NOTIFY_ENABLED, true);

  if (draftNotify) {
    if (!values.FEISHU_NOTIFY_OPEN_ID && !values.FEISHU_NOTIFY_CHAT_ID) {
      errors.push('缺少 FEISHU_NOTIFY_OPEN_ID 或 FEISHU_NOTIFY_CHAT_ID');
    }
    if (values.FEISHU_DRIVER === 'api') {
      if (!values.FEISHU_APP_ID) errors.push('FEISHU_DRIVER=api 需要 FEISHU_APP_ID');
      if (!values.FEISHU_APP_SECRET) errors.push('FEISHU_DRIVER=api 需要 FEISHU_APP_SECRET');
    } else if (values.FEISHU_DRIVER !== 'lark-cli') {
      errors.push(`FEISHU_DRIVER 非法：${values.FEISHU_DRIVER}。合法值：api | lark-cli`);
    }
  }

  if (!values.WECHAT_ACCOUNT_DISPLAY_NAME) {
    warnings.push('未设置 WECHAT_ACCOUNT_DISPLAY_NAME：多账号时飞书文案无法区分账号');
  }
  if (mode === 'api_freepublish') {
    warnings.push('api_freepublish 为实验模式：freepublish 成功不等于后台手动发表的可见性');
  }

  return { errors, warnings };
}
