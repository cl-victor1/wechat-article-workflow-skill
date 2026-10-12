/**
 * 飞书通知：草稿就绪（draft_notify_feishu）。有 media_id 后发摘要 + 后台入口。
 *
 * 两个驱动：
 *   api      直连飞书开放平台，需要 FEISHU_APP_ID / FEISHU_APP_SECRET
 *   lark-cli 复用本机 lark-cli bot
 */

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildMultipart, humanTime, mimeOf, PipelineError } from './util.mjs';

const execFileAsync = promisify(execFile);

export class FeishuNotifier {
  constructor({
    driver = 'api', apiBase = 'https://open.feishu.cn',
    appId, appSecret, openId, chatId, logger = null,
  }) {
    this.driver = driver;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.appId = appId;
    this.appSecret = appSecret;
    this.openId = openId;
    this.chatId = chatId;
    this.logger = logger;
    this.tenantToken = null;
    this.tokenExpireAt = 0;
  }

  log(msg) {
    if (this.logger) this.logger(msg);
  }

  get target() {
    if (this.openId) return { type: 'open_id', id: this.openId };
    if (this.chatId) return { type: 'chat_id', id: this.chatId };
    throw new PipelineError('未配置 FEISHU_NOTIFY_OPEN_ID 或 FEISHU_NOTIFY_CHAT_ID', { stage: 'feishu' });
  }

  async getTenantToken() {
    if (this.tenantToken && Date.now() < this.tokenExpireAt) return this.tenantToken;
    const resp = await fetch(`${this.apiBase}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    }).catch((err) => {
      throw new PipelineError(`飞书 token 请求失败：${err.message}`, { stage: 'feishu_token' });
    });
    const data = await resp.json();
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new PipelineError(`飞书 token 失败 ${data.code}: ${data.msg}`, { stage: 'feishu_token' });
    }
    this.tenantToken = data.tenant_access_token;
    this.tokenExpireAt = Date.now() + Math.max((data.expire || 7200) - 300, 60) * 1000;
    return this.tenantToken;
  }

  async apiSendText(text) {
    const token = await this.getTenantToken();
    const { type, id } = this.target;
    const resp = await fetch(
      `${this.apiBase}/open-apis/im/v1/messages?receive_id_type=${type}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: id,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      },
    ).catch((err) => {
      throw new PipelineError(`飞书发送失败：${err.message}`, { stage: 'feishu_send' });
    });
    const data = await resp.json();
    if (data.code !== 0) {
      throw new PipelineError(`飞书发送失败 ${data.code}: ${data.msg}`, { stage: 'feishu_send' });
    }
    return data.data?.message_id || null;
  }

  async apiUploadImage(imagePath) {
    const token = await this.getTenantToken();
    const data = readFileSync(imagePath);
    const { body, contentType } = buildMultipart(
      [{ name: 'image_type', value: 'message' }],
      [{ name: 'image', filename: basename(imagePath), contentType: mimeOf(imagePath), data }],
    );
    const resp = await fetch(`${this.apiBase}/open-apis/im/v1/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body,
    }).catch((err) => {
      throw new PipelineError(`飞书图片上传失败：${err.message}`, { stage: 'feishu_image' });
    });
    const json = await resp.json();
    if (json.code !== 0 || !json.data?.image_key) {
      throw new PipelineError(`飞书图片上传失败 ${json.code}: ${json.msg}`, { stage: 'feishu_image' });
    }
    return json.data.image_key;
  }

  async apiSendImage(imagePath) {
    const imageKey = await this.apiUploadImage(imagePath);
    const token = await this.getTenantToken();
    const { type, id } = this.target;
    const resp = await fetch(
      `${this.apiBase}/open-apis/im/v1/messages?receive_id_type=${type}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: id,
          msg_type: 'image',
          content: JSON.stringify({ image_key: imageKey }),
        }),
      },
    );
    const data = await resp.json();
    if (data.code !== 0) {
      throw new PipelineError(`飞书图片消息失败 ${data.code}: ${data.msg}`, { stage: 'feishu_send' });
    }
    return data.data?.message_id || null;
  }

  async cliSend(args, cwd) {
    try {
      const { stdout } = await execFileAsync('lark-cli', args, { cwd, timeout: 60000 });
      const match = stdout.match(/om_[A-Za-z0-9]+/);
      return match ? match[0] : null;
    } catch (err) {
      throw new PipelineError(`lark-cli 发送失败：${err.message}`, { stage: 'feishu_send' });
    }
  }

  cliTargetArgs() {
    const { type, id } = this.target;
    return type === 'open_id' ? ['--user-id', id] : ['--chat-id', id];
  }

  async sendText(text, cwd = process.cwd()) {
    if (this.driver === 'lark-cli') {
      return this.cliSend(['im', '+messages-send', '--as', 'bot', ...this.cliTargetArgs(), '--text', text], cwd);
    }
    return this.apiSendText(text);
  }

  /**
   * 发图。lark-cli 的 --image 只接受 cwd 相对路径，这里统一守住；
   * api 驱动把相对路径按 cwd 解析成绝对路径再读文件。
   */
  async sendImage(imagePath, cwd = process.cwd()) {
    if (this.driver === 'lark-cli') {
      if (isAbsolute(imagePath) || imagePath.includes('..')) {
        throw new PipelineError(`lark-cli 图片路径必须是 cwd 相对路径：${imagePath}`, { stage: 'feishu_image' });
      }
      return this.cliSend(['im', '+messages-send', '--as', 'bot', ...this.cliTargetArgs(), '--image', imagePath], cwd);
    }
    return this.apiSendImage(isAbsolute(imagePath) ? imagePath : resolve(cwd, imagePath));
  }
}

/** 组装「待发布·草稿已进箱」文案，字段与 references/publishing.md 对齐。 */
export function buildDraftReadyText({
  account, title, summary, mediaId, mpHome, at = new Date(), extraSteps = '',
}) {
  return [
    '【待发布·草稿已进箱】',
    '',
    `账号：${account || '（未配置账号名）'}`,
    `标题：${title}`,
    `摘要：${summary}`,
    `media_id：${mediaId}`,
    `时间：${humanTime(at)}`,
    '',
    '请管理员：',
    '1. 打开管理后台（确认右上角是本账号）',
    '2. 内容管理 → 草稿箱',
    '3. 按标题打开本文 → 检查封面/正文 → 点「发表」',
    ...(extraSteps ? ['', extraSteps] : []),
    '',
    '管理后台：',
    mpHome || 'https://mp.weixin.qq.com/',
    '',
    '说明：流水线仅完成 API 草稿 + 本通知，不自动正式发表（避免 freepublish 可见性异常）。',
  ].join('\n');
}
