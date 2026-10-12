/** 通用工具：日志、代理清理、时间、脱敏。 */

const C = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function paint(color, text) {
  return process.stdout.isTTY ? `${color}${text}${C.reset}` : text;
}

export const log = {
  step: (msg) => console.log(paint(C.blue, `→ ${msg}`)),
  ok: (msg) => console.log(paint(C.green, `✓ ${msg}`)),
  warn: (msg) => console.log(paint(C.yellow, `! ${msg}`)),
  fail: (msg) => console.error(paint(C.red, `✗ ${msg}`)),
  info: (msg) => console.log(paint(C.gray, `  ${msg}`)),
  plain: (msg) => console.log(msg),
};

/** 微信 API 必须直连；飞书在代理下常见 token 超时。调用前统一清理。 */
export function clearProxyEnv() {
  const keys = [
    'http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY',
    'all_proxy', 'ALL_PROXY',
  ];
  const cleared = [];
  for (const key of keys) {
    if (process.env[key]) {
      cleared.push(key);
      delete process.env[key];
    }
  }
  return cleared;
}

/** 只保留首尾各几位，避免密钥进日志。 */
export function mask(value, head = 6, tail = 2) {
  if (!value) return '(未配置)';
  if (value.length <= head + tail) return '*'.repeat(value.length);
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

/** 带时区偏移的本地时间戳，例如 2026-09-12T23:40:00+08:00。 */
export function isoLocal(date = new Date()) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`;
}

export function humanTime(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function today(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 流水线错误：带阶段名，便于归档与告警定位。 */
export class PipelineError extends Error {
  constructor(message, { stage, detail } = {}) {
    super(message);
    this.name = 'PipelineError';
    this.stage = stage || 'unknown';
    this.detail = detail || null;
  }
}

/** 手动构建 multipart/form-data，零依赖。 */
export function buildMultipart(fields = [], files = []) {
  const boundary = '----WxpubBoundary' + Math.random().toString(36).slice(2);
  const chunks = [];

  for (const { name, value } of fields) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`, 'utf-8'));
  }

  for (const { name, filename, contentType, data } of files) {
    chunks.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`, 'utf-8'));
    chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    chunks.push(Buffer.from('\r\n', 'utf-8'));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

export function mimeOf(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/**
 * 读文件头判断真实图片格式，避免「扩展名是 jpg、内容是 HTML」导致微信报错。
 * 返回 png | jpg | gif | bmp | null。
 */
export function sniffImageType(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') return 'gif';
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'bmp';
  return null;
}
