/**
 * 本地 mock：模拟微信开放平台与飞书开放平台。
 * 只用于自测，让整条流水线在没有真凭证时也能端到端跑通。
 */

import { createServer } from 'node:http';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d4944415478da63f8cfc0f01f00050001ff9a2d1c00' +
  '00000049454e44ae426082', 'hex');

const OK_APP_ID = 'wx_mock_appid';
const OK_APP_SECRET = 'mock_app_secret';
const OK_FEISHU_APP_ID = 'cli_mock_app';
const OK_FEISHU_APP_SECRET = 'mock_feishu_secret';

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function json(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/**
 * @param {object} faults 故障注入，例如 { wechatToken: 40164, feishuSend: true }
 */
export async function startMockServer(faults = {}) {
  const calls = [];
  let publishPolls = 0;
  let coverPolls = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const body = await readBody(req);
    calls.push({ path, method: req.method, size: body.length });

    // ---- 微信 ----
    if (path === '/cgi-bin/token') {
      if (faults.wechatToken) {
        return json(res, { errcode: faults.wechatToken, errmsg: 'invalid ip, not in whitelist' });
      }
      if (url.searchParams.get('appid') !== OK_APP_ID ||
          url.searchParams.get('secret') !== OK_APP_SECRET) {
        return json(res, { errcode: 40013, errmsg: 'invalid appid' });
      }
      return json(res, { access_token: 'mock_access_token', expires_in: 7200 });
    }

    if (path === '/cgi-bin/material/add_material') {
      if (faults.coverUpload) return json(res, { errcode: 40005, errmsg: 'invalid file type' });
      if (body.length < 100) return json(res, { errcode: 41005, errmsg: 'media data missing' });
      return json(res, { media_id: 'mock_thumb_media_id', url: 'https://mmbiz.qpic.cn/mock_cover' });
    }

    if (path === '/cgi-bin/media/uploadimg') {
      const n = calls.filter((c) => c.path === path).length;
      return json(res, { url: `https://mmbiz.qpic.cn/mock_image_${n}` });
    }

    if (path === '/cgi-bin/draft/add') {
      if (faults.draftAdd) return json(res, { errcode: 45009, errmsg: 'api freq out of limit' });
      const parsed = JSON.parse(body.toString('utf-8'));
      const article = parsed.articles[0];
      if (!article.title) return json(res, { errcode: 40125, errmsg: 'title missing' });
      if (!article.thumb_media_id) return json(res, { errcode: 40007, errmsg: 'thumb_media_id missing' });
      server.lastDraft = article;
      return json(res, { media_id: 'mock_draft_media_id' });
    }

    if (path === '/cgi-bin/freepublish/submit') {
      return json(res, { publish_id: '100000001' });
    }

    if (path === '/cgi-bin/freepublish/get') {
      publishPolls += 1;
      if (publishPolls < 2) return json(res, { publish_status: 1 });
      return json(res, {
        publish_id: '100000001',
        publish_status: 0,
        article_id: 'mock_article_id',
        article_detail: { item: [{ article_url: 'https://mp.weixin.qq.com/s/mock' }] },
      });
    }

    // ---- kie.ai 封面生成 ----
    if (path === '/api/v1/jobs/createTask') {
      if (req.headers.authorization !== 'Bearer kie_mock_key') {
        return json(res, { code: 401, msg: 'invalid api key' });
      }
      const parsed = JSON.parse(body.toString('utf-8'));
      if (parsed.model !== 'nano-banana-2-lite') {
        return json(res, { code: 422, msg: `unsupported model: ${parsed.model}` });
      }
      if (!parsed.input?.prompt) return json(res, { code: 400, msg: 'prompt required' });
      server.lastCoverTask = parsed;
      return json(res, { code: 200, msg: 'success', data: { taskId: 'mock_task_1' } });
    }

    if (path === '/api/v1/jobs/recordInfo') {
      coverPolls += 1;
      if (faults.coverGen) {
        return json(res, {
          code: 200, msg: 'success',
          data: { taskId: 'mock_task_1', state: 'fail', failCode: '500', failMsg: 'model busy' },
        });
      }
      if (coverPolls < 2) {
        return json(res, { code: 200, msg: 'success', data: { taskId: 'mock_task_1', state: 'waiting' } });
      }
      return json(res, {
        code: 200, msg: 'success',
        data: {
          taskId: 'mock_task_1', state: 'success', costTime: 1200,
          resultJson: JSON.stringify({ resultUrls: [`${server.baseUrl}/mock-image.png`] }),
        },
      });
    }

    if (path === '/mock-image.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(PNG_1X1);
    }

    // ---- 飞书 ----
    if (path === '/open-apis/auth/v3/tenant_access_token/internal') {
      const parsed = JSON.parse(body.toString('utf-8'));
      if (parsed.app_id !== OK_FEISHU_APP_ID || parsed.app_secret !== OK_FEISHU_APP_SECRET) {
        return json(res, { code: 10003, msg: 'invalid app credentials' });
      }
      return json(res, { code: 0, msg: 'ok', tenant_access_token: 'mock_tenant_token', expire: 7200 });
    }

    if (path === '/open-apis/im/v1/messages') {
      if (faults.feishuSend) return json(res, { code: 230001, msg: 'bot not in chat' });
      if (req.headers.authorization !== 'Bearer mock_tenant_token') {
        return json(res, { code: 99991663, msg: 'invalid token' });
      }
      const parsed = JSON.parse(body.toString('utf-8'));
      server.lastMessage = parsed;
      if (parsed.msg_type === 'text') server.lastTextMessage = parsed;
      const n = calls.filter((c) => c.path === path).length;
      return json(res, { code: 0, msg: 'ok', data: { message_id: `om_mock_${n}` } });
    }

    if (path === '/open-apis/im/v1/images') {
      return json(res, { code: 0, msg: 'ok', data: { image_key: 'img_v3_mock' } });
    }

    return json(res, { errcode: 404, errmsg: `no mock route: ${path}` }, 404);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  server.calls = calls;
  server.baseUrl = `http://127.0.0.1:${port}`;
  server.close2 = () => new Promise((resolve) => server.close(resolve));
  return server;
}

export const MOCK_CREDENTIALS = {
  KIE_API_KEY: 'kie_mock_key',
  WECHAT_APP_ID: OK_APP_ID,
  WECHAT_APP_SECRET: OK_APP_SECRET,
  FEISHU_APP_ID: OK_FEISHU_APP_ID,
  FEISHU_APP_SECRET: OK_FEISHU_APP_SECRET,
};
