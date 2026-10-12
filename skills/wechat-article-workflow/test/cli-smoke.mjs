/**
 * CLI 级冒烟测试：真正 spawn scripts/wxpub.mjs，覆盖 init / doctor / new / render / publish。
 * 微信与飞书都指向本地 mock，不碰真账号。
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { MOCK_CREDENTIALS, startMockServer } from './mock-server.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'scripts', 'wxpub.mjs');

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

async function run(args, { cwd, env = {} }) {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI, ...args], {
      cwd, env: { ...process.env, ...env }, timeout: 60000,
    });
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    return { code: err.code ?? 1, out: (err.stdout || '') + (err.stderr || '') };
  }
}

function writePng(path) {
  writeFileSync(path, Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63f8cfc0f01f00050001ff9a2d1c00' +
    '00000049454e44ae426082', 'hex'));
}

export async function runCliSmoke() {
  const project = mkdtempSync(join(tmpdir(), 'wxpub-cli-'));
  const server = await startMockServer();
  const mockEnv = {
    ...MOCK_CREDENTIALS,
    WECHAT_API_BASE: server.baseUrl,
    FEISHU_API_BASE: server.baseUrl,
    KIE_BASE_URL: server.baseUrl,
    COVER_POLL_INTERVAL_MS: '10',
    FEISHU_NOTIFY_OPEN_ID: 'ou_mock_operator',
    WECHAT_ACCOUNT_DISPLAY_NAME: 'CLI 自测号',
  };
  console.log(`临时项目：${project}`);
  console.log(`mock 服务：${server.baseUrl}`);

  console.log('\n[CLI 1. init]');
  let r = await run(['init'], { cwd: project });
  check('init 退出码 0', r.code === 0, r.out);
  check('生成 .wxpub/.env', existsSync(join(project, '.wxpub', '.env')));
  check('生成 footer.md', existsSync(join(project, '.wxpub', 'footer.md')));
  check('生成 past-articles.json', existsSync(join(project, '.wxpub', 'past-articles.json')));
  check('生成 collections.json', existsSync(join(project, '.wxpub', 'collections.json')));
  const envText = readFileSync(join(project, '.wxpub', '.env'), 'utf-8');
  check('.env 是占位符，无真密钥', envText.includes('fill_in_valid_value_in_target_environment'));

  console.log('\n[CLI 2. doctor：缺配置应失败]');
  r = await run(['doctor'], { cwd: project, env: { HOME: project } });
  check('缺凭证时 doctor 退出码 1', r.code === 1, r.out.slice(-300));
  check('指出缺少 WECHAT_APP_ID', r.out.includes('缺少 WECHAT_APP_ID'));

  console.log('\n[CLI 3. doctor --online：mock 凭证应通过]');
  r = await run(['doctor', '--online'], { cwd: project, env: { HOME: project, ...mockEnv } });
  check('doctor --online 退出码 0', r.code === 0, r.out.slice(-400));
  check('微信 token 通过', r.out.includes('access_token 获取成功'));
  check('飞书 token 通过', r.out.includes('tenant_access_token 获取成功'));
  check('AppSecret 已脱敏', !r.out.includes(MOCK_CREDENTIALS.WECHAT_APP_SECRET));

  console.log('\n[CLI 4. doctor --online：错 IP 白名单]');
  const badServer = await startMockServer({ wechatToken: 40164 });
  r = await run(['doctor', '--online'], {
    cwd: project,
    env: { HOME: project, ...mockEnv, WECHAT_API_BASE: badServer.baseUrl, FEISHU_API_BASE: badServer.baseUrl },
  });
  check('40164 时退出码 1', r.code === 1);
  check('给出白名单提示', r.out.includes('IP 白名单'));
  await badServer.close2();

  console.log('\n[CLI 5. new + render]');
  r = await run(['new', '--date', '2026-09-12'], { cwd: project });
  const pkgDir = join(project, 'output', '2026-09-12');
  check('new 退出码 0', r.code === 0, r.out);
  check('生成 article.md', existsSync(join(pkgDir, 'article.md')));

  // 默认策略：只放一张 cover.png，正文不写任何图片引用
  writeFileSync(join(pkgDir, 'article.md'), [
    '---',
    'title: CLI 冒烟测试文章',
    'summary: 通过本地 mock 验证整条命令行链路。',
    'author: CLI 自测号',
    '---',
    '',
    '# CLI 冒烟测试文章',
    '',
    '正文第一段，带**重点**。',
  ].join('\n'), 'utf-8');
  console.log('\n[CLI 5.5 cover：自动生成封面]');
  r = await run(['cover', pkgDir], { cwd: project, env: { HOME: project, ...mockEnv } });
  check('cover 退出码 0', r.code === 0, r.out.slice(-300));
  check('封面已落盘', existsSync(join(pkgDir, 'cover.png')));
  check('输出写明模型', r.out.includes('nano-banana-2-lite'));
  r = await run(['cover', pkgDir], { cwd: project, env: { HOME: project, ...mockEnv, KIE_API_KEY: '' } });
  check('缺 key 时 cover 失败', r.code === 1, r.out.slice(-200));

  r = await run(['render', pkgDir, '--out', join(project, 'preview.html')], { cwd: project });
  check('render 退出码 0', r.code === 0, r.out);
  const preview = readFileSync(join(project, 'preview.html'), 'utf-8');
  check('预览含 h1', preview.includes('<h1 style='));
  check('预览无本地图片引用', !preview.includes('<img src="./'));

  r = await run(['render', pkgDir, '--theme', 'orange', '--preview'], { cwd: project, env: { HOME: project } });
  check('render --preview 退出码 0', r.code === 0, r.out.slice(-300));
  const previewPage = readFileSync(join(pkgDir, 'preview.html'), 'utf-8');
  check('预览页带主题强调色', previewPage.includes('#ff6a00'));
  check('预览页是完整 HTML', previewPage.startsWith('<!doctype html>'));
  r = await run(['render', pkgDir, '--theme', 'nope'], { cwd: project, env: { HOME: project } });
  check('未知主题退出码 1', r.code === 1);

  console.log('\n[CLI 6. publish --dry-run]');
  r = await run(['publish', pkgDir, '--dry-run'], { cwd: project, env: { HOME: project } });
  check('dry-run 退出码 0', r.code === 0, r.out.slice(-300));
  check('dry-run 无凭证也能跑', r.out.includes('dry_run'));

  console.log('\n[CLI 7. publish draft_notify_feishu（mock）]');
  r = await run(['publish', pkgDir, '--mode', 'draft_notify_feishu'], { cwd: project, env: { HOME: project, ...mockEnv } });
  check('publish 退出码 0', r.code === 0, r.out.slice(-400));
  check('状态 draft_ready_notified', r.out.includes('draft_ready_notified'));
  check('提示人工发表', r.out.includes('手动发表'));
  const status = JSON.parse(readFileSync(join(pkgDir, 'output', 'publish-status.json'), 'utf-8'));
  check('归档 media_id', status.media_id === 'mock_draft_media_id');
  check('归档账号名', status.account === 'CLI 自测号');
  check('归档记录正文首图来自封面', status.lead_image?.source === 'cover.png');
  check('未上传其它正文图', status.content_images.length === 0);
  check('草稿正文以封面图开头', server.lastDraft.content.startsWith('<img src="https://mmbiz.qpic.cn'));
  check('草稿正文含往期文章', server.lastDraft.content.includes('往期文章精选：'));
  check('归档记录合集', typeof status.collection === 'string' && status.collection.length > 0);
  check('归档记录四项后台待办', status.post_draft_settings?.length === 4);
  check('终端提示 API 不支持这四项', r.out.includes('API 不支持'));
  const lastText = server.lastTextMessage ? JSON.parse(server.lastTextMessage.content).text : '';
  check('飞书文案含后台三步', lastText.includes('草稿箱'), lastText.slice(0, 60));
  check('飞书文案含 media_id', lastText.includes('mock_draft_media_id'));
  check('飞书最后一条是封面图', server.lastMessage?.msg_type === 'image');

  console.log('\n[CLI 8. past / footer 命令]');
  r = await run(['past', 'add', '--title', '新的一篇', '--url', 'https://mp.weixin.qq.com/s/new'], { cwd: project });
  check('past add 退出码 0', r.code === 0, r.out);
  r = await run(['past', 'list'], { cwd: project });
  check('past list 含新文章', r.out.includes('新的一篇'));
  check('新文章排在第一', r.out.trimStart().startsWith(' 1. 新的一篇') || r.out.includes('1. 新的一篇'));
  r = await run(['past', 'remove', '--url', 'https://mp.weixin.qq.com/s/new'], { cwd: project });
  check('past remove 退出码 0', r.code === 0);
  r = await run(['past', 'list'], { cwd: project });
  check('移除后不再出现', !r.out.includes('新的一篇'));
  r = await run(['footer'], { cwd: project, env: { HOME: project, PROFILE_NICKNAME: '从0到AI' } });
  check('footer 预览含往期标题', r.out.includes('往期文章精选：'));
  check('footer 预览含名片', r.out.includes('从0到AI'));

  console.log('\n[CLI 9. notify --draft-ready]');
  r = await run([
    'notify', '--draft-ready', '--title', '手动通知测试',
    '--summary', '摘要', '--media-id', 'mid_123',
  ], { cwd: project, env: { HOME: project, ...mockEnv } });
  check('notify 退出码 0', r.code === 0, r.out.slice(-300));
  check('返回 message_id', r.out.includes('om_mock_'));

  console.log('\n[CLI 10. 未知命令]');
  r = await run(['nope'], { cwd: project });
  check('未知命令退出码 2', r.code === 2);

  await server.close2();

  console.log(`\n通过 ${passed}，失败 ${failed}`);
  if (failed) {
    console.log('失败项：');
    for (const item of failures) console.log(`  - ${item}`);
    return 1;
  }
  console.log('CLI 冒烟全部通过。');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCliSmoke().then((code) => { process.exitCode = code; });
}
