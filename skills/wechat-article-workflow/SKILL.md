---
name: wechat-article-workflow
description: >
  End-to-end WeChat Official Account (微信公众号) article workflow. Find a topic from live
  trending lists, write the article in a voice that reads well on a phone, make one cover image,
  lay it out with an inline-style theme, preview it at phone width, and save it to the drafts box
  through the official WeChat interface. Use this skill when the user wants to find 选题, write,
  format (排版), or publish a 公众号 article, or set up the `wxpub` tool.
---

# WeChat Article Workflow

One skill for the whole path: **topic → outline → draft → cover → layout → preview → drafts box**.
A human presses "发表" in the WeChat admin page. The skill never publishes to followers by default.

All commands use the zero-dependency command-line tool in this skill. It needs Node.js 18 or later.

```bash
WXPUB="node <skill-dir>/scripts/wxpub.mjs"   # <skill-dir> = the base directory of this skill
```

Run every command from the user's **project directory** (where articles live), not from the skill
directory. The tool reads configuration from `~/.wxpub/.env`, then `<project>/.wxpub/.env`, then
the process environment.

## Workspace layout

```text
<project>/
├─ .wxpub/
│  ├─ .env                 # credentials and switches (never commit)
│  ├─ footer.md            # self-introduction shown at the end of every article
│  ├─ past-articles.json   # "往期文章" list shown at the end
│  └─ collections.json     # keyword rules that pick the 合集 name
└─ output/YYYY-MM-DD/      # one package per article
   ├─ topics.md            # topic radar snapshot (step 1)
   ├─ article.md           # the article with frontmatter
   ├─ cover.png            # the only image: cover + first image in the body
   ├─ preview.html         # phone-width preview (step 5)
   └─ output/publish-status.json
```

## First run

```bash
$WXPUB init               # creates .wxpub/ with placeholders and today's package
$WXPUB doctor             # checks configuration
$WXPUB doctor --online    # also checks the WeChat token (needs the address allowlist, IP 白名单)
```

Steps 1 to 5 need **no credentials**. Only step 6 needs `WECHAT_APP_ID` and `WECHAT_APP_SECRET`.
If they are missing, finish steps 1 to 5 and tell the user what to fill in. See
`references/publishing.md` for the setup.

## The workflow

### Step 1: Find a topic

```bash
$WXPUB new                                     # creates output/<today>/article.md
$WXPUB topics --out output/<today>/topics.md   # Zhihu, Baidu, V2EX, sspai, Hacker News, GitHub
$WXPUB topics --sources hackernews,producthunt,google-trends --geo US
$WXPUB topics --rss https://example.com/feed.xml   # any RSS or Atom feed, comma-separated
```

Then pick a topic with the user. Follow `references/topic-discovery.md`:

1. Read the radar and the user's niche. Shortlist 3 candidates.
2. For each candidate give the angle, the target reader, and why now.
3. Let the user choose. If the user already has a topic, skip the radar.
4. Gather facts with web search. Write a fact list of 3 to 5 items with source names.

### Step 2: Outline

Propose a title (20 Chinese characters or fewer works best, hard limit 64), a one-line summary
(hard limit 120), and 3 to 5 section headings. Get a quick yes from the user before you write.

### Step 3: Write `article.md`

Follow `references/writing-style.md`. The hard rules:

- Frontmatter holds `title`, `author`, `summary`, `cover: ./cover.png`. Optional: `theme`, `collection`.
- Do not repeat the title as `# Title` in the body.
- Section headings use `## 1、小标题`.
- Every number comes from the fact list, never from memory.
- No engagement-begging ending. Never ask for 点赞, 在看, 转发, or "help the algorithm".
  End on the content: a stance, a real question, or the next topic.

### Step 4: Cover image

One image per article: `cover.png`, 16:9. It becomes the draft cover and the first image of the
body. See `references/cover-image.md`.

```bash
$WXPUB cover output/<today>                          # needs KIE_API_KEY
$WXPUB cover output/<today> --prompt "..." --ratio 16:9
```

Without `KIE_API_KEY`, use any image tool the agent has, or ask the user for an image, and save
it as `output/<today>/cover.png`. Keep text out of the image; models misspell Chinese characters.

### Step 5: Layout and preview

```bash
$WXPUB render output/<today> --preview                 # writes output/<today>/preview.html
$WXPUB render output/<today> --theme orange --preview  # try another theme
```

Themes: `default` (blue bar), `green` (WeChat green bar), `orange` (underline), `ink` (black,
centered headings, for long essays). Set one per article with `theme:` in the frontmatter, or for
all articles with `THEME=` in `.wxpub/.env`. Open `preview.html` and show it to the user. See
`references/formatting.md` for the supported Markdown and the end-of-article block.

### Step 6: Save to the drafts box

```bash
$WXPUB publish output/<today> --dry-run   # validates and renders, sends nothing
$WXPUB publish output/<today>             # uploads the cover, creates the draft
```

Success means a `media_id` in the output and in `output/publish-status.json`. Then tell the user:

1. Open https://mp.weixin.qq.com/ → 内容管理 → 草稿箱.
2. Set the four items the interface cannot set: 原创, 赞赏, 合集, 智能插入广告. The tool prints
   the values to pick.
3. Press 发表.

`PUBLISH_MODE=draft_notify_feishu` also sends this checklist to Feishu. `api_freepublish`
publishes directly and is experimental. Details in `references/publishing.md`.

## Other commands

```bash
$WXPUB past add --title "标题" --url "https://mp.weixin.qq.com/s?__biz=...&mid=...&idx=1&sn=..."
$WXPUB past list
$WXPUB footer                              # preview the end-of-article block
$WXPUB draft refresh-footer [<media_id>…]  # rebuild the footer of drafts already in the box
$WXPUB draft delete <media_id>
$WXPUB selftest                            # offline tests with a mock server
```

Exit codes: 0 success, 1 failure, 2 usage error.

## Errors you will meet

| Code | Meaning | Fix |
|------|---------|-----|
| 40164 | The machine's public address is not on the allowlist | Add it in 设置与开发 → 基本配置 → IP 白名单 |
| 40001 / 40125 | Wrong AppSecret | Copy it again from 基本配置 |
| 45166 | Invalid content, usually a short `mp.weixin.qq.com/s/<id>` link | Use the long `?__biz=` link, or keep `PAST_ARTICLES_LINK_MODE=text` |
| 40113 | The image format does not match its extension | Re-save as real PNG or JPEG |
| 48001 | The account type has no permission for that interface | Use draft mode; press 发表 by hand |

## Rules

- Never write real credentials into the package, the article, or the chat. They live only in `.wxpub/.env`.
- Never publish to followers unless the user asks for it in this conversation.
- Show the user the title, summary, and preview before step 6.
