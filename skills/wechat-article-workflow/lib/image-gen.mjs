/**
 * 封面图生成：kie.ai jobs API（默认模型 nano-banana-2-lite）。
 *
 * 两步流程：
 *   POST /api/v1/jobs/createTask   -> taskId
 *   GET  /api/v1/jobs/recordInfo   -> state=waiting|success|fail，success 时给 resultUrls
 *
 * 生成的图落到当日包，文件名按真实格式定为 cover.png / cover.jpg。
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PipelineError, sniffImageType } from './util.mjs';

const ASPECT_RATIOS = new Set([
  '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5',
  '5:4', '8:1', '9:16', '16:9', '21:9', 'auto',
]);

export class KieImageClient {
  constructor({
    apiKey, baseUrl = 'https://api.kie.ai',
    model = 'nano-banana-2-lite', logger = null,
  }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.logger = logger;
  }

  log(msg) {
    if (this.logger) this.logger(msg);
  }

  async request(path, options = {}) {
    let resp;
    try {
      resp = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(options.headers || {}),
        },
      });
    } catch (err) {
      throw new PipelineError(`kie.ai 请求失败：${err.message}`, { stage: 'cover_gen' });
    }
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new PipelineError(`kie.ai 返回非 JSON（HTTP ${resp.status}）`, {
        stage: 'cover_gen', detail: { body: text.slice(0, 200) },
      });
    }
    if (data.code !== 200) {
      throw new PipelineError(`kie.ai 错误 ${data.code}: ${data.msg}`, {
        stage: 'cover_gen', detail: { code: data.code },
      });
    }
    return data.data;
  }

  async createTask({ prompt, aspectRatio = '16:9', imageUrls = [] }) {
    if (!prompt) throw new PipelineError('封面提示词为空', { stage: 'cover_gen' });
    if (!ASPECT_RATIOS.has(aspectRatio)) {
      throw new PipelineError(
        `不支持的比例：${aspectRatio}。可选：${[...ASPECT_RATIOS].join(' ')}`,
        { stage: 'cover_gen' },
      );
    }
    const input = { prompt, aspect_ratio: aspectRatio };
    if (imageUrls.length) input.image_urls = imageUrls;

    const data = await this.request('/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input }),
    });
    if (!data?.taskId) throw new PipelineError('kie.ai 未返回 taskId', { stage: 'cover_gen' });
    return data.taskId;
  }

  /** 轮询直到 success 或 fail。 */
  async waitForResult(taskId, { attempts = 60, intervalMs = 5000 } = {}) {
    for (let n = 1; n <= attempts; n += 1) {
      const data = await this.request(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
      if (data.state === 'success') {
        const parsed = JSON.parse(data.resultJson || '{}');
        const urls = parsed.resultUrls || [];
        if (!urls.length) throw new PipelineError('kie.ai 成功但无图片 URL', { stage: 'cover_gen' });
        this.log(`生成完成，用时 ${data.costTime ?? '?'} ms`);
        return urls;
      }
      if (data.state === 'fail') {
        throw new PipelineError(`kie.ai 生成失败 ${data.failCode}: ${data.failMsg}`, { stage: 'cover_gen' });
      }
      this.log(`第 ${n} 次查询：state=${data.state}`);
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new PipelineError('kie.ai 轮询超时', { stage: 'cover_gen' });
  }

  /** 下载图片并按真实格式写盘，返回文件路径。 */
  async download(url, dir, basename = 'cover') {
    let resp;
    try {
      resp = await fetch(url);
    } catch (err) {
      throw new PipelineError(`下载封面失败：${err.message}`, { stage: 'cover_gen' });
    }
    if (!resp.ok) {
      throw new PipelineError(`下载封面失败：HTTP ${resp.status}`, { stage: 'cover_gen' });
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const type = sniffImageType(buffer);
    if (!type) throw new PipelineError('下载到的不是有效图片', { stage: 'cover_gen' });
    const file = join(dir, `${basename}.${type}`);
    writeFileSync(file, buffer);
    return { file, bytes: buffer.length, type };
  }
}

const DEFAULT_STYLE = '现代简约的中文科技自媒体封面插画，扁平矢量风格，明亮配色，构图居中留白，无文字，无水印';

/** 按标题与风格拼封面提示词。 */
export function buildCoverPrompt({ title, summary = '', style = '', extra = '' }) {
  const parts = [
    `为一篇微信公众号文章生成封面图。文章标题：${title}。`,
    summary ? `文章要点：${summary}。` : '',
    `画面风格：${style || DEFAULT_STYLE}。`,
    '画面中不要出现任何文字、字母或数字。',
    '尤其不要出现任何中文汉字，生图模型写出的汉字常常是错字。',
    extra,
  ];
  return parts.filter(Boolean).join('');
}

/**
 * 一步生成封面：建任务 -> 轮询 -> 下载。
 * @returns {{ file: string, url: string, taskId: string, prompt: string }}
 */
export async function generateCover({ dir, title, summary, values, prompt, logger }) {
  const apiKey = values.KIE_API_KEY;
  if (!apiKey) {
    throw new PipelineError('缺少 KIE_API_KEY，无法生成封面', { stage: 'cover_gen' });
  }
  const client = new KieImageClient({
    apiKey,
    baseUrl: values.KIE_BASE_URL || 'https://api.kie.ai',
    model: values.IMAGE_MODEL || 'nano-banana-2-lite',
    logger,
  });
  const finalPrompt = prompt || buildCoverPrompt({
    title, summary, style: values.COVER_PROMPT_STYLE,
  });
  const taskId = await client.createTask({
    prompt: finalPrompt,
    aspectRatio: values.COVER_ASPECT_RATIO || '16:9',
  });
  const urls = await client.waitForResult(taskId, {
    attempts: Number(values.COVER_POLL_ATTEMPTS || 60),
    intervalMs: Number(values.COVER_POLL_INTERVAL_MS || 5000),
  });
  const saved = await client.download(urls[0], dir);
  return { ...saved, url: urls[0], taskId, prompt: finalPrompt };
}
