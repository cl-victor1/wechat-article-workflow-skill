# Publishing to the Drafts Box

## One-time setup

1. Open https://mp.weixin.qq.com/ → 设置与开发 → 基本配置.
2. Copy the **AppID**. Reset and copy the **AppSecret** (it is shown only once).
3. Add the public address of the machine that runs the tool to **IP 白名单**.
   Find it with `curl -s https://ifconfig.me`. Home connections change address; if you see
   40164, add the new address.
4. Fill `.wxpub/.env`:

```env
WECHAT_APP_ID=wx...
WECHAT_APP_SECRET=...
WECHAT_AUTHOR=你的笔名
PUBLISH_MODE=draft_only
```

5. Run `node <skill-dir>/scripts/wxpub.mjs doctor --online`. It must print "access_token 获取成功".

Some account types lack permission for `freepublish` (48001); draft mode still works.

## What `publish` does

1. Checks the package: title and summary length, cover format, every body image exists.
2. Builds the end-of-article block. A bad link fails here, before any upload.
3. Clears proxy environment variables. WeChat checks the real public address.
4. Gets the access token, uploads the cover as permanent material.
5. Uploads body images and the cover as the lead image.
6. Renders the HTML with the theme, adds the footer, creates the draft.
7. Writes `output/publish-status.json` with `media_id`, the chosen 合集, and the to-do list.

`--dry-run` stops after rendering and sends nothing. It needs no credentials.

## Modes

| `PUBLISH_MODE` | Result | When |
|----------------|--------|------|
| `draft_only` (default) | Draft in the box | Daily use |
| `draft_notify_feishu` | Draft, plus a Feishu message with the summary, cover, and to-do list | Scheduled runs on a server |
| `api_freepublish` | Draft, then `freepublish` | Experimental. Articles published this way can behave differently from ones published by hand |

Override for one run with `--mode <mode>`.

### Feishu notification

Needs a Feishu custom app with the bot capability and permission to send messages:

```env
FEISHU_DRIVER=api
FEISHU_APP_ID=cli_...
FEISHU_APP_SECRET=...
FEISHU_NOTIFY_OPEN_ID=ou_...      # or FEISHU_NOTIFY_CHAT_ID=oc_...
```

`FEISHU_DRIVER=lark-cli` reuses a logged-in `lark-cli` bot instead.

## What the interface cannot set

The drafts interface has no fields for these four settings. The tool prints the value to choose,
and you set them in the admin page before you press 发表:

| Setting | Configuration | Value printed |
|---------|---------------|---------------|
| 原创声明 | `ORIGINAL_DECLARE=true` | On, with the author name |
| 赞赏 | `REWARD_ENABLED=true`, `REWARD_ACCOUNT=` | On, with the account name |
| 合集 | `.wxpub/collections.json` or `collection:` in frontmatter | The best keyword match |
| 智能插入广告 | `SMART_AD_ENABLED=true`, `SMART_AD_MAX_INSERTIONS=2` | On, at most N |

Comments are set by the interface: `NEED_OPEN_COMMENT`, `ONLY_FANS_CAN_COMMENT`.

`collections.json` scoring: a keyword in the title scores 3, each match in the body scores 1
(at most 3 per keyword). The highest total wins. With no match, the entry with `"default": true` wins.

## Scheduled runs

`publish` exits with 1 on any failure, so cron or launchd can alert on it. A typical daily job:

```bash
cd /path/to/project && node <skill-dir>/scripts/wxpub.mjs publish output/$(date +%F) --auto-cover
```

Do not run unattended `api_freepublish`. Keep a human on the 发表 button.

## Errors

| Code | Meaning | Fix |
|------|---------|-----|
| 40164 | Address not on the allowlist | Add the address printed in the error |
| 40001, 40125 | Wrong AppSecret or expired token | Copy the AppSecret again |
| 40113 | Unsupported image file | Re-save as real PNG or JPEG |
| 45166 | Invalid content | Short `mp.weixin.qq.com/s/` link in the body or footer. Use the long link |
| 45009 | Daily interface quota reached | Wait until tomorrow |
| 48001 | No permission for this interface | Use draft mode |
| 53401 | Cover crop out of range | Use a 16:9 cover |
