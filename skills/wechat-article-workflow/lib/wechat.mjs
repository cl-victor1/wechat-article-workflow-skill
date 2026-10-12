/**
 * 微信公众号 API 客户端（零依赖）。
 *
 * 只封装本流水线用到的 5 个接口：
 *   token / material.add_material / media.uploadimg / draft.add / freepublish
 * 调用前必须清代理，微信 API 要求直连。
 */

import { readFileSync } from 'node:fs';
import { buildMultipart, mimeOf, sniffImageType, PipelineError } from './util.mjs';

export class WechatClient {
  constructor({ appId, appSecret, apiBase = 'https://api.weixin.qq.com', logger = null }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.logger = logger;
    this.token = null;
    this.tokenExpireAt = 0;
  }

  log(msg) {
    if (this.logger) this.logger(msg);
  }

  async request(path, options = {}, stage = 'wechat') {
    const url = `${this.apiBase}${path}`;
    let resp;
    try {
      resp = await fetch(url, options);
    } catch (err) {
      throw new PipelineError(`请求微信 API 失败：${err.message}`, { stage, detail: { url: path } });
    }
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new PipelineError(`微信 API 返回非 JSON（HTTP ${resp.status}）`, {
        stage, detail: { body: text.slice(0, 200) },
      });
    }
    if (data.errcode && data.errcode !== 0) {
      throw new PipelineError(`微信 API 错误 ${data.errcode}: ${data.errmsg}`, {
        stage, detail: { errcode: data.errcode, errmsg: data.errmsg },
      });
    }
    return data;
  }

  async getAccessToken() {
    if (this.token && Date.now() < this.tokenExpireAt) return this.token;
    const path = `/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`;
    const data = await this.request(path, {}, 'token');
    if (!data.access_token) {
      throw new PipelineError('微信未返回 access_token', { stage: 'token' });
    }
    this.token = data.access_token;
    this.tokenExpireAt = Date.now() + Math.max((data.expires_in || 7200) - 300, 60) * 1000;
    this.log(`access_token 就绪，有效期 ${data.expires_in || 7200}s`);
    return this.token;
  }

  /** 读图并校验真实格式，防止「扩展名对、内容错」。 */
  readImage(filePath, stage) {
    const data = readFileSync(filePath);
    const real = sniffImageType(data);
    if (!real) {
      throw new PipelineError(`不是有效图片：${filePath}`, { stage, detail: { filePath } });
    }
    const name = filePath.split(/[/\\]/).pop();
    const declared = name.split('.').pop().toLowerCase();
    const normalized = declared === 'jpeg' ? 'jpg' : declared;
    if (normalized !== real) {
      this.log(`注意：${name} 实际格式是 ${real}，按实际格式上传`);
    }
    return { data, filename: `${name.replace(/\.[^.]+$/, '')}.${real}`, contentType: mimeOf(`x.${real}`) };
  }

  /** 封面必须是永久素材，返回 thumb_media_id。 */
  async uploadPermanentImage(filePath) {
    const token = await this.getAccessToken();
    const { data, filename, contentType } = this.readImage(filePath, 'cover_upload');
    const { body, contentType: ct } = buildMultipart(
      [{ name: 'type', value: 'image' }],
      [{ name: 'media', filename, contentType, data }],
    );
    const res = await this.request(
      `/cgi-bin/material/add_material?access_token=${token}&type=image`,
      { method: 'POST', headers: { 'Content-Type': ct }, body },
      'cover_upload',
    );
    if (!res.media_id) {
      throw new PipelineError('封面上传未返回 media_id', { stage: 'cover_upload' });
    }
    return res.media_id;
  }

  /** 正文图走 uploadimg，返回可直接写进 HTML 的微信 URL。 */
  async uploadContentImage(filePath) {
    const token = await this.getAccessToken();
    const { data, filename, contentType } = this.readImage(filePath, 'image_upload');
    const { body, contentType: ct } = buildMultipart(
      [],
      [{ name: 'media', filename, contentType, data }],
    );
    const res = await this.request(
      `/cgi-bin/media/uploadimg?access_token=${token}`,
      { method: 'POST', headers: { 'Content-Type': ct }, body },
      'image_upload',
    );
    if (!res.url) {
      throw new PipelineError('正文图上传未返回 url', { stage: 'image_upload' });
    }
    return res.url;
  }

  /** 创建草稿，返回 media_id。这是 draft_notify_feishu 的技术成功判据。 */
  async createDraft(article) {
    const token = await this.getAccessToken();
    const payload = {
      articles: [{
        title: article.title,
        author: article.author || '',
        digest: article.digest || '',
        content: article.content,
        content_source_url: article.contentSourceUrl || '',
        thumb_media_id: article.thumbMediaId,
        need_open_comment: article.needOpenComment ? 1 : 0,
        only_fans_can_comment: article.onlyFansCanComment ? 1 : 0,
      }],
    };
    const res = await this.request(
      `/cgi-bin/draft/add?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
      'draft_add',
    );
    if (!res.media_id) {
      throw new PipelineError('draft/add 未返回 media_id', { stage: 'draft_add' });
    }
    return res.media_id;
  }

  /** List every draft in the draft box via draft/batchget, following pagination. */
  async listDrafts({ pageSize = 20 } = {}) {
    const items = [];
    for (let offset = 0; ; offset += pageSize) {
      const token = await this.getAccessToken();
      const res = await this.request(
        `/cgi-bin/draft/batchget?access_token=${token}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offset, count: pageSize, no_content: 0 }),
        },
        'draft_batchget',
      );
      const page = res.item || [];
      items.push(...page);
      if (page.length < pageSize || items.length >= (res.total_count || 0)) break;
    }
    return items;
  }

  /** Overwrite article `index` of a draft via draft/update. `article` must carry every field. */
  async updateDraft(mediaId, index, article) {
    const token = await this.getAccessToken();
    const res = await this.request(
      `/cgi-bin/draft/update?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId, index, articles: article }),
      },
      'draft_update',
    );
    if (res && res.errcode) {
      throw new PipelineError(`draft/update 失败 ${res.errcode}: ${res.errmsg || ''}`, { stage: 'draft_update' });
    }
    return true;
  }

  /** 删除草稿箱里的一篇草稿（draft/delete）。 */
  async deleteDraft(mediaId) {
    const token = await this.getAccessToken();
    const res = await this.request(
      `/cgi-bin/draft/delete?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId }),
      },
      'draft_delete',
    );
    if (res && res.errcode) {
      throw new PipelineError(`draft/delete 失败 ${res.errcode}: ${res.errmsg || ''}`, { stage: 'draft_delete' });
    }
    return true;
  }

  async freepublishSubmit(mediaId) {
    const token = await this.getAccessToken();
    const res = await this.request(
      `/cgi-bin/freepublish/submit?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId }),
      },
      'freepublish_submit',
    );
    return res.publish_id;
  }

  async freepublishGet(publishId) {
    const token = await this.getAccessToken();
    return this.request(
      `/cgi-bin/freepublish/get?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish_id: publishId }),
      },
      'freepublish_get',
    );
  }

  /** 轮询发布状态。0=成功 1=发布中 2=原创审核中 其它=失败。 */
  async freepublishWait(publishId, { attempts = 20, intervalMs = 3000 } = {}) {
    for (let n = 1; n <= attempts; n += 1) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const data = await this.freepublishGet(publishId);
      const status = data.publish_status;
      this.log(`第 ${n} 次查询：publish_status=${status}`);
      if (status === 1) continue;
      return {
        publish_id: publishId,
        publish_status: status,
        article_id: data.article_id || null,
        article_url: data.article_detail?.item?.[0]?.article_url || null,
      };
    }
    return { publish_id: publishId, publish_status: -1, article_id: null, article_url: null };
  }
}
