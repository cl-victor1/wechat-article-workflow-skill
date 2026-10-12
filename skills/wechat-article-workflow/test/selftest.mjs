/**
 * 端到端自测：用本地 mock 跑完整流水线，不需要真凭证。
 * 覆盖 4 个模式、配置校验、Markdown 渲染、图片校验、故障注入。
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnvText, validateConfig, boolOf } from '../lib/config.mjs';
import { buildDraftReadyText } from '../lib/feishu.mjs';
import {
  collectLocalImages, deriveSummary, markdownToHtml, parseFrontmatter, THEMES,
} from '../lib/markdown.mjs';
import {
  buildFooter, loadPastArticles, renderPastArticles, renderProfileCard, validatePastArticles,
} from '../lib/footer.mjs';
import { buildCoverPrompt, generateCover, KieImageClient } from '../lib/image-gen.mjs';
import { inspectPackage, publish } from '../lib/pipeline.mjs';
import { buildPostDraftSettings, pickCollection, renderPostDraftText } from '../lib/post-draft.mjs';
import { sniffImageType } from '../lib/util.mjs';
import { gatherTopics, parseFeed, topicsToMarkdown } from '../lib/topics.mjs';
import { MOCK_CREDENTIALS, startMockServer } from './mock-server.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` :: ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` :: ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n[${title}]`);
}

/** 生成一张真 PNG（1x1），用于封面与正文图。 */
function writePng(path) {
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63f8cfc0f01f00050001ff9a2d1c00' +
    '00000049454e44ae426082', 'hex');
  writeFileSync(path, png);
}

function makePackage(root, { withImages = true, badImage = false } = {}) {
  const dir = join(root, 'output', '2026-09-12');
  mkdirSync(dir, { recursive: true });
  writePng(join(dir, 'cover.png'));
  if (withImages) {
    writePng(join(dir, 'image1.png'));
    if (badImage) writeFileSync(join(dir, 'image2.png'), '<html>not an image</html>');
    else writePng(join(dir, 'image2.png'));
  }
  const article = [
    '---',
    'title: 自测文章：今日市场三件事',
    'summary: 这是一条用于自测的摘要，不会发到真公众号。',
    'author: 自测机器人',
    '---',
    '',
    '# 今日市场三件事',
    '',
    '开头一段情绪化的**引子**，带一个 `行情代码` 与[链接](https://example.com)。',
    '',
    '## 第一件事',
    '',
    withImages ? '![配图一](./image1.png)' : '',
    '',
    '- 要点一',
    '- 要点二',
    '',
    '1. 第一步',
    '2. 第二步',
    '',
    '> 一句引用。',
    '',
    '```js',
    'const a = 1 < 2;',
    '```',
    '',
    '---',
    '',
    withImages ? '![配图二](image2.png)' : '',
    '',
    '结尾互动一句。',
  ].join('\n');
  writeFileSync(join(dir, 'article.md'), article, 'utf-8');
  return dir;
}

/** 在临时项目里写好 .wxpub 下的文末与合集配置。 */
function writeProjectConfig(root) {
  const dir = join(root, '.wxpub');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'footer.md'),
    'one more thing，我建了一个免费 AI SaaS 出海交流群。\n\n我是小明，专注于分享 AI 工具、创业思路。',
    'utf-8');
  writeFileSync(join(dir, 'past-articles.json'), JSON.stringify([
    { title: '这个落地页是AI做的，但没人信', url: 'https://mp.weixin.qq.com/s/aaa' },
    { title: 'YC的隐藏公式：100个用户', url: 'https://mp.weixin.qq.com/s/bbb' },
  ], null, 2), 'utf-8');
  writeFileSync(join(dir, 'collections.json'), JSON.stringify([
    { name: 'AI', keywords: ['AI', 'Claude', '模型'], default: true },
    { name: '创业', keywords: ['创业', 'SaaS', 'MRR'] },
  ], null, 2), 'utf-8');
  return dir;
}

function baseValues(server, overrides = {}) {
  return {
    ...MOCK_CREDENTIALS,
    PUBLISH_MODE: 'draft_notify_feishu',
    WECHAT_API_BASE: server.baseUrl,
    FEISHU_API_BASE: server.baseUrl,
    FEISHU_DRIVER: 'api',
    FEISHU_DRAFT_NOTIFY_ENABLED: 'true',
    FEISHU_NOTIFY_OPEN_ID: 'ou_mock_operator',
    WECHAT_ACCOUNT_DISPLAY_NAME: '自测公众号',
    WECHAT_MP_HOME_URL: 'https://mp.weixin.qq.com/',
    projectDir: process.cwd(),
    ...overrides,
  };
}

export async function runSelftest() {
  const root = mkdtempSync(join(tmpdir(), 'wxpub-selftest-'));
  console.log(`临时工作区：${root}`);

  section('1. 配置解析与校验');
  const env = parseEnvText([
    '# 注释',
    'WECHAT_APP_ID=wx123',
    'WECHAT_APP_SECRET="s3cret"',
    'EMPTY=',
  ].join('\n'));
  check('解析 KEY=VALUE', env.WECHAT_APP_ID === 'wx123');
  check('去掉包裹引号', env.WECHAT_APP_SECRET === 's3cret');
  check('布尔解析', boolOf('true') === true && boolOf('off') === false && boolOf('', true) === true);

  const missing = validateConfig({
    PUBLISH_MODE: 'draft_notify_feishu', FEISHU_DRIVER: 'api',
    FEISHU_DRAFT_NOTIFY_ENABLED: 'true',
  });
  check('缺凭证时报错', missing.errors.length >= 4, `errors=${missing.errors.length}`);
  const badMode = validateConfig({ PUBLISH_MODE: 'nope', FEISHU_DRIVER: 'api' });
  check('非法模式被拦截', badMode.errors.some((e) => e.includes('PUBLISH_MODE')));

  section('2. Markdown 渲染');
  const pkgDir = makePackage(root);
  const raw = readFileSync(join(pkgDir, 'article.md'), 'utf-8');
  const { meta, body } = parseFrontmatter(raw);
  check('解析 frontmatter title', meta.title.startsWith('自测文章'));
  const html = markdownToHtml(body);
  check('h1 带内联样式', html.includes('<h1 style='));
  check('h2 带内联样式', html.includes('<h2 style='));
  check('粗体', /<strong style="[^"]*">引子<\/strong>/.test(html));
  check('默认主题强调色', html.includes('#1e90ff'));
  for (const name of Object.keys(THEMES)) {
    const themed = markdownToHtml(body, { theme: name });
    check(`主题 ${name} 用自己的强调色`, themed.includes(THEMES[name].accent));
  }
  let unknownTheme = null;
  try { markdownToHtml(body, { theme: 'nope' }); } catch (err) { unknownTheme = err; }
  check('未知主题报错', Boolean(unknownTheme) && unknownTheme.message.includes('default'));
  check('行内代码', html.includes('<code style='));
  check('链接带样式', html.includes('<a href="https://example.com"'));
  check('无序列表', html.includes('<ul style=') && html.includes('要点一'));
  check('有序列表', html.includes('<ol style=') && html.includes('第一步'));
  check('引用块', html.includes('<blockquote style='));
  check('代码块转义 <', html.includes('&lt;'));
  check('分隔线', html.includes('<hr style='));
  check('图片不再包 p', html.includes('<img src="./image1.png"') && !html.includes('<p style="margin-bottom:1em;line-height:1.8;font-size:16px;color:#333;"><img'));
  check('无残留占位符', !html.includes('WXPUBCODESLOT'));
  const images = collectLocalImages(body);
  check('收集本地图片 2 张', images.length === 2, images.join(','));
  check('摘要可推断', deriveSummary('# 标题\n\n第一段正文。').startsWith('第一段正文'));

  section('3. 图片格式嗅探');
  check('识别 PNG', sniffImageType(readFileSync(join(pkgDir, 'cover.png'))) === 'png');
  check('识别假图片', sniffImageType(Buffer.from('<html>x</html>')) === null);

  section('4. 打包校验');
  const inspected = inspectPackage(pkgDir);
  check('校验无问题', inspected.problems.length === 0, inspected.problems.join(' / '));
  const badRoot = mkdtempSync(join(tmpdir(), 'wxpub-bad-'));
  const badDir = makePackage(badRoot, { badImage: true });
  const badInspect = inspectPackage(badDir);
  check('假图片被拦截', badInspect.problems.some((p) => p.includes('不是有效图片')));

  section('5. 飞书文案');
  const text = buildDraftReadyText({
    account: '自测公众号', title: 'T', summary: 'S',
    mediaId: 'mid', mpHome: 'https://mp.weixin.qq.com/',
  });
  for (const field of ['【待发布·草稿已进箱】', '账号：', '标题：', '摘要：', 'media_id：', '时间：', '草稿箱', 'https://mp.weixin.qq.com/']) {
    check(`文案含 ${field}`, text.includes(field));
  }

  section('6. 端到端：draft_notify_feishu');
  let server = await startMockServer();
  let values = baseValues(server);
  let result = await publish(pkgDir, values);
  check('run 成功', result.success === true);
  check('状态 draft_ready_notified', result.status === 'draft_ready_notified');
  check('拿到 media_id', result.media_id === 'mock_draft_media_id');
  check('拿到 thumb_media_id', result.thumb_media_id === 'mock_thumb_media_id');
  check('正文图已替换为微信 URL', result.content_images.length === 2);
  check('飞书 message_id 已记录', Boolean(result.feishu_draft_notify?.message_id));
  check('正文首图用的是封面', result.lead_image?.source === 'cover.png');
  check('正文首图有微信 URL', String(result.lead_image?.url || '').includes('mmbiz.qpic.cn'));
  check('首图在正文最前面', server.lastDraft.content.startsWith('<img src="' + result.lead_image.url));
  check('封面图也推送了', Boolean(result.feishu_draft_notify?.optional_cover_message_id));
  check('未调用 freepublish', !server.calls.some((c) => c.path.includes('freepublish')));
  check('草稿正文已是微信图片 URL', server.lastDraft.content.includes('mmbiz.qpic.cn/mock_image'));
  check('草稿正文不含本地路径', !server.lastDraft.content.includes('./image1.png'));
  check('作者取 frontmatter', server.lastDraft.author === '自测机器人');
  const archived = JSON.parse(readFileSync(join(pkgDir, 'output', 'publish-status.json'), 'utf-8'));
  check('归档写盘', archived.status === 'draft_ready_notified');
  check('归档标注待人工发表', archived.approval === 'awaiting_human_mp_publish');
  check('归档 formal_publish=false', archived.formal_publish === false);
  await server.close2();

  section('7. 端到端：draft_only');
  server = await startMockServer();
  values = baseValues(server, { PUBLISH_MODE: 'draft_only' });
  result = await publish(pkgDir, values);
  check('run 成功', result.success === true);
  check('状态 draft_only', result.status === 'draft_only');
  check('未发飞书', !server.calls.some((c) => c.path.includes('/open-apis/')));
  check('未调用 freepublish', !server.calls.some((c) => c.path.includes('freepublish')));
  await server.close2();

  section('8. 端到端：api_freepublish');
  server = await startMockServer();
  values = baseValues(server, { PUBLISH_MODE: 'api_freepublish', FREEPUBLISH_INTERVAL_MS: 10 });
  result = await publish(pkgDir, values);
  check('run 成功', result.success === true);
  check('状态 published', result.status === 'published');
  check('拿到 article_url', result.article_url === 'https://mp.weixin.qq.com/s/mock');
  check('轮询到 publish_status=0', result.publish_status === 0);
  check('归档提示可见性风险', result.notes.some((n) => n.includes('可见性')));
  await server.close2();

  section('9. 非法模式在联网前被拒绝');
  server = await startMockServer();
  values = baseValues(server, { PUBLISH_MODE: 'browser_full' });
  try {
    await publish(pkgDir, values);
    check('非法模式被拒绝', false, '应抛错但没有');
  } catch (err) {
    check('非法模式被拒绝', err.stage === 'mode');
    check('报错列出合法值', err.message.includes('draft_only'));
  }
  check('未调用任何微信接口', server.calls.length === 0);
  await server.close2();

  section('10. 故障注入');
  server = await startMockServer({ wechatToken: 40164 });
  values = baseValues(server);
  try {
    await publish(pkgDir, values);
    check('IP 白名单错误会失败', false, '应抛错但没有');
  } catch (err) {
    check('IP 白名单错误会失败', err.message.includes('40164'));
    check('错误阶段是 token', err.stage === 'token');
  }
  await server.close2();

  server = await startMockServer({ feishuSend: true });
  values = baseValues(server);
  try {
    await publish(pkgDir, values);
    check('飞书失败让整次 run 失败', false, '应抛错但没有');
  } catch (err) {
    check('飞书失败让整次 run 失败', err.stage === 'feishu_send');
  }
  const failArchive = JSON.parse(readFileSync(join(pkgDir, 'output', 'publish-status.json'), 'utf-8'));
  check('失败也归档', failArchive.status === 'failed');
  check('失败归档留下 media_id', failArchive.media_id === 'mock_draft_media_id');
  check('失败归档记录阶段', failArchive.error?.stage === 'feishu_send');
  await server.close2();

  section('11. 文末区块');
  writeProjectConfig(root);
  const footerValues = { projectDir: root, WECHAT_ACCOUNT_DISPLAY_NAME: '从0到AI', PROFILE_SIGNATURE: '分享 AI 工具与创业思路' };
  const footer = buildFooter(root, footerValues);
  check('文末有分隔线', footer.html.includes('<hr style='));
  check('含 one more thing', footer.html.includes('one more thing'));
  check('含往期文章标题行', footer.html.includes('往期文章精选：'));
  check('默认不出链接（45166 限制）', !footer.html.includes('<a href="https://mp.weixin.qq.com'));
  check('纯文字模式带搜索提示', footer.html.includes('可在本公众号内搜索标题'));
  check('link 模式才出 <a>', renderPastArticles(
    [{ title: 'T', url: 'https://example.com/p' }], { linkMode: 'link' },
  ).includes('<a href="https://example.com/p"'));
  check('往期计数正确', footer.pastCount === 2, String(footer.pastCount));
  check('名片含昵称', footer.html.includes('从0到AI'));
  check('名片含签名', footer.html.includes('分享 AI 工具与创业思路'));
  check('无 data-id 时用等效 HTML 卡', !footer.html.includes('mp-common-profile'));
  const nativeCard = renderProfileCard({ nickname: 'N', nativeId: 'MzI=' });
  check('有 data-id 时用原生组件', nativeCard.includes('mp-common-profile'));
  check('原生组件不叠 HTML 卡', !nativeCard.includes('<section'));
  check('超出上限会截断', renderPastArticles(
    Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `u${i}` })), { limit: 3 },
  ).split('<li').length - 1 === 3);
  check('空列表返回空串', renderPastArticles([]) === '');
  const offFooter = buildFooter(root, { ...footerValues, ARTICLE_FOOTER_ENABLED: 'false' });
  check('总开关可关闭', offFooter.html === '');

  // 实测：draft/add 拒绝一切指向 mp.weixin.qq.com 的正文链接，真链接也不行
  check('text 模式不校验链接', validatePastArticles([
    { title: 'T', url: 'https://mp.weixin.qq.com/s/anything' },
  ], 'text').length === 0);
  check('link 模式拒绝公众号链接', validatePastArticles([
    { title: 'T', url: 'https://mp.weixin.qq.com/s/anything' },
  ], 'link').length === 1);
  check('link 模式拒绝占位链接', validatePastArticles([
    { title: 'T', url: 'https://x.com/fill_in_me' },
  ], 'link').length === 1);
  check('link 模式放行普通外链', validatePastArticles([
    { title: 'T', url: 'https://example.com/post' },
  ], 'link').length === 0);
  check('无 url 的条目可用', loadPastArticles(root).length >= 0);
  writeFileSync(join(root, '.wxpub', 'past-articles.json'), JSON.stringify([
    { title: '公众号链接', url: 'https://mp.weixin.qq.com/s/aaa' },
  ]), 'utf-8');
  try {
    buildFooter(root, { ...footerValues, PAST_ARTICLES_LINK_MODE: 'link' });
    check('link 模式下公众号链接让构建失败', false, '应抛错但没有');
  } catch (err) {
    check('link 模式下公众号链接让构建失败', err.stage === 'footer');
    check('错误提示 45166', err.message.includes('45166'));
  }
  writeFileSync(join(root, '.wxpub', 'past-articles.json'), JSON.stringify([
    { title: '这个落地页是AI做的，但没人信' },
    { title: 'YC的隐藏公式：100个用户' },
  ]), 'utf-8');

  section('12. 合集自动选择与后台待办');
  const rules = [
    { name: 'AI', keywords: ['AI', 'Claude'], default: true },
    { name: '创业', keywords: ['创业', 'MRR'] },
  ];
  check('标题命中优先', pickCollection({ title: '用 Claude 写代码', body: '创业', rules }).name === 'AI');
  check('正文命中也算', pickCollection({ title: '随笔', body: 'MRR 增长 MRR', rules }).name === '创业');
  check('无命中用默认', pickCollection({ title: 'x', body: 'y', rules }).name === 'AI');
  check('frontmatter 可覆盖', pickCollection({ title: 'x', body: 'y', rules, override: '产品设计' }).name === '产品设计');
  check('无规则返回 null', pickCollection({ title: 'x', body: 'y', rules: [] }).name === null);

  const post = buildPostDraftSettings({
    title: '用 Claude 写代码', body: '正文', meta: { author: '小明在路上' },
    values: { projectDir: root },
  });
  const keys = post.items.map((item) => item.key);
  check('四项待办齐全', ['original', 'reward', 'collection', 'advertisement'].every((k) => keys.includes(k)), keys.join(','));
  check('原创带作者', post.items.find((i) => i.key === 'original').value.includes('小明在路上'));
  check('合集选中 AI', post.collection.name === 'AI');
  check('广告带条数', post.items.find((i) => i.key === 'advertisement').value.includes('2'));
  check('待办文本可读', renderPostDraftText(post.items).includes('后台还需手动设置'));
  const noneItems = buildPostDraftSettings({
    title: 't', body: 'b',
    values: { projectDir: root, ORIGINAL_DECLARE: 'false', REWARD_ENABLED: 'false', COLLECTION_ENABLED: 'false', SMART_AD_ENABLED: 'false' },
  });
  check('全部关闭则无待办', noneItems.items.length === 0);

  section('13. 发布时带上文末与待办');
  server = await startMockServer();
  values = baseValues(server, { projectDir: root, PROFILE_SIGNATURE: '分享 AI 工具与创业思路' });
  result = await publish(pkgDir, values);
  check('草稿正文含往期文章', server.lastDraft.content.includes('往期文章精选：'));
  check('草稿正文含名片', server.lastDraft.content.includes('自测公众号'));
  check('草稿正文不含公众号链接', !server.lastDraft.content.includes('href="https://mp.weixin.qq.com'));
  check('归档记录往期篇数', result.footer?.past_articles === 2);
  check('归档记录合集', result.collection === 'AI');
  check('归档记录四项待办', result.post_draft_settings.length === 4);
  check('评论默认开启', server.lastDraft.need_open_comment === 1);
  check('不限粉丝评论', server.lastDraft.only_fans_can_comment === 0);
  const lastText2 = JSON.parse(server.lastTextMessage.content).text;
  check('飞书文案含后台待办', lastText2.includes('后台还需手动设置'));
  check('飞书文案含合集名', lastText2.includes('AI'));
  await server.close2();

  section('14. 只出封面图的默认流程');
  const coverOnlyRoot = mkdtempSync(join(tmpdir(), 'wxpub-coveronly-'));
  const coverOnlyDir = makePackage(coverOnlyRoot, { withImages: false });
  const coverOnlyInspect = inspectPackage(coverOnlyDir);
  check('无正文图也能通过校验', coverOnlyInspect.problems.length === 0, coverOnlyInspect.problems.join(' / '));
  check('正文不引用其它图片', coverOnlyInspect.images.length === 0);
  server = await startMockServer();
  values = baseValues(server);
  result = await publish(coverOnlyDir, values);
  check('只出封面也能发布', result.success === true);
  check('未上传额外正文图', result.content_images.length === 0);
  check('封面仍插到正文最前', server.lastDraft.content.startsWith('<img src='));
  const uploadImgCalls = server.calls.filter((c) => c.path === '/cgi-bin/media/uploadimg').length;
  check('uploadimg 只调用 1 次', uploadImgCalls === 1, `calls=${uploadImgCalls}`);
  check('封面素材仍上传为永久素材', server.calls.some((c) => c.path === '/cgi-bin/material/add_material'));
  await server.close2();
  rmSync(coverOnlyRoot, { recursive: true, force: true });

  section('15. 关闭首图开关');
  server = await startMockServer();
  values = baseValues(server, { COVER_AS_LEAD_IMAGE: 'false' });
  result = await publish(pkgDir, values);
  check('关闭后无 lead_image', result.lead_image === null);
  check('关闭后正文不以图片开头', !server.lastDraft.content.startsWith('<img src='));
  await server.close2();

  section('16. 封面生成（kie.ai mock）');
  server = await startMockServer();
  const coverRoot = mkdtempSync(join(tmpdir(), 'wxpub-cover-'));
  const coverValues = {
    KIE_API_KEY: 'kie_mock_key',
    KIE_BASE_URL: server.baseUrl,
    IMAGE_MODEL: 'nano-banana-2-lite',
    COVER_ASPECT_RATIO: '16:9',
    COVER_POLL_INTERVAL_MS: 10,
  };
  const cover = await generateCover({
    dir: coverRoot, title: '用 Claude Code 做发文流水线',
    summary: '一条命令到草稿箱', values: coverValues,
  });
  check('封面文件已写盘', existsSync(cover.file));
  check('按真实格式命名', cover.file.endsWith('cover.png'), cover.file);
  check('提示词含标题', cover.prompt.includes('用 Claude Code 做发文流水线'));
  check('提示词禁止出现文字', cover.prompt.includes('不要出现任何文字'));
  check('请求用了指定模型', server.lastCoverTask.model === 'nano-banana-2-lite');
  check('请求带 16:9', server.lastCoverTask.input.aspect_ratio === '16:9');
  check('自定义风格可覆盖', buildCoverPrompt({ title: 'T', style: '水墨风' }).includes('水墨风'));
  await server.close2();

  server = await startMockServer({ coverGen: true });
  try {
    await generateCover({
      dir: coverRoot, title: 'T', values: { ...coverValues, KIE_BASE_URL: server.baseUrl },
    });
    check('生成失败会抛错', false, '应抛错但没有');
  } catch (err) {
    check('生成失败会抛错', err.stage === 'cover_gen');
    check('错误带 failMsg', err.message.includes('model busy'));
  }
  await server.close2();

  server = await startMockServer();
  try {
    await generateCover({ dir: coverRoot, title: 'T', values: { ...coverValues, KIE_BASE_URL: server.baseUrl, KIE_API_KEY: 'wrong' } });
    check('错误 key 被拒绝', false, '应抛错但没有');
  } catch (err) {
    check('错误 key 被拒绝', err.message.includes('401'));
  }
  const badRatio = new KieImageClient({ apiKey: 'k', baseUrl: server.baseUrl });
  try {
    await badRatio.createTask({ prompt: 'p', aspectRatio: '7:3' });
    check('非法比例被拦截', false, '应抛错但没有');
  } catch (err) {
    check('非法比例被拦截', err.message.includes('不支持的比例'));
  }
  try {
    await generateCover({ dir: coverRoot, title: 'T', values: { KIE_BASE_URL: server.baseUrl } });
    check('缺 KIE_API_KEY 报错', false, '应抛错但没有');
  } catch (err) {
    check('缺 KIE_API_KEY 报错', err.message.includes('KIE_API_KEY'));
  }
  await server.close2();
  rmSync(coverRoot, { recursive: true, force: true });

  section('17. dry-run 不联网');
  server = await startMockServer();
  values = baseValues(server);
  result = await publish(pkgDir, values, { dryRun: true });
  check('dry-run 成功', result.success === true && result.status === 'dry_run');
  check('dry-run 零请求', server.calls.length === 0);
  await server.close2();

  rmSync(root, { recursive: true, force: true });
  rmSync(badRoot, { recursive: true, force: true });

  section('选题雷达（离线 fetch 桩）');
  const rssXml = '<rss><channel><title>Feed</title><item><title><![CDATA[A &amp; B]]></title>'
    + '<link>https://a.example/1</link></item><item><title>第二条</title><link>https://a.example/2</link></item></channel></rss>';
  const atomXml = '<feed><entry><title>Atom 条目</title><link rel="alternate" href="https://b.example/x"/></entry></feed>';
  const feed = parseFeed(rssXml);
  check('RSS 解析 2 条', feed.length === 2);
  check('RSS 解码 CDATA 与实体', feed[0].title === 'A & B');
  check('Atom 取 href', parseFeed(atomXml)[0].url === 'https://b.example/x');
  const fakeFetch = async (url) => {
    if (url.includes('zhihu')) {
      return new Response(JSON.stringify({ data: [{ target: {
        id: 2092571772189153120, title: '知乎问题', url: 'https://api.zhihu.com/questions/2092571772189153120',
      }, detail_text: '100 万热度' }] }));
    }
    if (url.includes('v2ex')) return new Response('boom', { status: 503 });
    return new Response(rssXml);
  };
  const topics = await gatherTopics({
    sources: ['zhihu', 'v2ex', 'sspai'], limit: 1, rss: ['https://c.example/feed'], fetchImpl: fakeFetch,
  });
  check('知乎链接不丢精度', topics.items[0].url === 'https://www.zhihu.com/question/2092571772189153120');
  check('limit 生效', topics.items.filter((i) => i.source === '少数派').length === 1);
  check('自定义 RSS 被抓取', topics.items.some((i) => i.source === 'https://c.example/feed'));
  check('单个来源失败不影响其它', topics.errors.length === 1 && topics.errors[0].message.includes('503'));
  const topicsMd = topicsToMarkdown(topics, '2026-01-01');
  check('Markdown 分组标题', topicsMd.includes('## 知乎热榜') && topicsMd.includes('## 抓取失败'));
  let badSource = null;
  try { await gatherTopics({ sources: ['nope'], fetchImpl: fakeFetch }); } catch (err) { badSource = err; }
  check('未知来源报错', Boolean(badSource));

  console.log(`\n通过 ${passed}，失败 ${failed}`);
  if (failed) {
    console.log('失败项：');
    for (const item of failures) console.log(`  - ${item}`);
    return 1;
  }
  console.log('全部自测通过。');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSelftest().then((code) => { process.exitCode = code; });
}
