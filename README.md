# WeChat Article Workflow Skill

**Follow me for more:** X [@victor_UWer](https://x.com/victor_UWer) · WeChat Official Account「从0到AI」

<p align="center">
  <strong>English</strong> | <a href="./README.zh-CN.md">中文</a>
</p>

> **This automated workflow has already grown my WeChat Official Account by 5,000 followers.**

An agent skill that runs the whole WeChat Official Account (微信公众号) writing workflow:

```text
topic radar → angle and fact list → outline → article.md → cover.png
          → themed layout → phone-width preview → WeChat drafts box
```

You talk to your agent ("help me write today's article about X"). The skill tells the agent what
to do at each step, and a zero-dependency Node.js command-line tool (`wxpub`) does the mechanical
work: fetching trending lists, rendering inline-style HTML, uploading images, and creating the draft.

The skill **never publishes to your followers by default**. It stops at the drafts box, and you
press 发表 yourself.

## Features

| Step | What you get |
|------|--------------|
| Topic discovery | `wxpub topics` pulls Zhihu, Baidu, V2EX, sspai, Hacker News, GitHub, Product Hunt, Google Trends, or any feed you add. No login, no keys. |
| Writing | Rules for titles, openings, short paragraphs, facts versus opinions, and a ban on "please like and share" endings. |
| Cover image | One 16:9 cover per article, used as the draft cover and as the first image of the body. Generated through kie.ai, or bring your own. |
| Layout (排版) | 4 themes (`default`, `green`, `orange`, `ink`), all inline styles, so the WeChat editor keeps them. |
| Preview | `wxpub render --preview` writes a 375px-wide `preview.html`. |
| Drafts box | Uploads the cover and images, creates the draft, prints the 4 settings the official interface cannot set (原创, 赞赏, 合集, ads). |
| End-of-article block | Past-article list, self-introduction, and the account card, added to every article. |
| Notifications | Optional Feishu message with the summary and the to-do list, for scheduled runs. |
| Tests | 200+ offline checks against a mock WeChat server: `npm test`. |

## Requirements

- An agent that loads skills: [Claude Code](https://claude.com/claude-code), or any agent that reads `SKILL.md`
- Node.js 18 or later (no `npm install` needed)
- For the drafts box step only: a WeChat Official Account with its AppID, AppSecret, and an entry in the address allowlist (IP 白名单)
- Optional: a [kie.ai](https://kie.ai/api-key) key for cover generation, a Feishu app for notifications

Steps 1 to 5 (topic to preview) need no account at all.

## Install

### Option 1: Claude Code plugin

```text
/plugin marketplace add cl-victor1/wechat-article-workflow-skill
/plugin install wechat-article-workflow@wechat-article-workflow-skill
```

### Option 2: `skills` command-line tool (works with many agents)

```bash
npx skills add cl-victor1/wechat-article-workflow-skill
```

### Option 3: copy the folder

```bash
git clone https://github.com/cl-victor1/wechat-article-workflow-skill.git
mkdir -p ~/.claude/skills
cp -r wechat-article-workflow-skill/skills/wechat-article-workflow ~/.claude/skills/
```

Restart your agent after you install.

## Quick start

Make a folder for your articles and open your agent there:

```bash
mkdir my-wechat && cd my-wechat
claude
```

Then just ask:

> 用 wechat-article-workflow 帮我找今天的选题，写一篇公众号文章，排版后放进草稿箱

The agent will run `wxpub init`, show you the trending topics, agree on an angle with you, write the
article, make the cover, show you the preview, and create the draft.

### Fill in your account (once)

`wxpub init` creates `.wxpub/.env`. Fill in at least:

```env
WECHAT_APP_ID=wx...
WECHAT_APP_SECRET=...
WECHAT_AUTHOR=Your pen name
```

1. Open [mp.weixin.qq.com](https://mp.weixin.qq.com/) → 设置与开发 → 基本配置.
2. Copy the AppID, reset and copy the AppSecret.
3. Add your machine's public address (`curl -s https://ifconfig.me`) to the address allowlist (IP 白名单).
4. Run `wxpub doctor --online`.

Put shared settings in `~/.wxpub/.env` to use them across projects. Never commit `.wxpub/`.

## Use the tool directly

```bash
WXPUB="node ~/.claude/skills/wechat-article-workflow/scripts/wxpub.mjs"

$WXPUB init                                   # create .wxpub/ and today's package
$WXPUB topics --out output/2026-10-12/topics.md
$WXPUB cover output/2026-10-12                # needs KIE_API_KEY
$WXPUB render output/2026-10-12 --theme ink --preview
$WXPUB publish output/2026-10-12 --dry-run    # validates, sends nothing
$WXPUB publish output/2026-10-12              # creates the draft
```

Run `$WXPUB --help` for every command.

## Repository layout

```text
.claude-plugin/                 plugin and marketplace manifests
skills/wechat-article-workflow/
├─ SKILL.md                     the workflow the agent follows
├─ references/                  topic discovery, writing, cover, formatting, publishing
├─ scripts/wxpub.mjs            command-line entry
├─ lib/                         renderer, WeChat client, topic radar, footer, Feishu
├─ templates/                   .env, article, footer, collections templates
└─ test/                        offline tests and a mock WeChat server
```

## Common questions

**Does it publish without me?**
No. The default mode is `draft_only`. `api_freepublish` exists but is experimental and off by default.

**Why only one image?**
One strong cover is enough for most articles, and it keeps the workflow fast. Add extra images
with `![](./extra.jpg)` when you need them.

**Why are 原创, 赞赏, 合集 not set automatically?**
The official drafts interface has no fields for them. The tool prints what to pick so you can set
them in 10 seconds before you press 发表.

**I get error 45166.**
A short `mp.weixin.qq.com/s/<id>` link is in the article or the past-article list. Use the long
`?__biz=...&mid=...&idx=...&sn=...` link.

**I get error 40164.**
Your public address changed. Add the new one to the address allowlist (IP 白名单).

## License

MIT
