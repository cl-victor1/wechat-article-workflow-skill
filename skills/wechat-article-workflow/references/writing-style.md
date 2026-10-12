# Writing Style

Goal: an article that reads easily on a phone, has a clear stance, and keeps facts and opinions apart.

## Frontmatter

```markdown
---
title: 文章标题
author: 作者名
summary: 一句话摘要
cover: ./cover.png
theme: default
collection: AI
---
```

| Field | Rule |
|-------|------|
| `title` | Hard limit 64 characters. 12 to 20 Chinese characters work best. Make it concrete. |
| `author` | The pen name shown under the title. Falls back to `WECHAT_AUTHOR`. |
| `summary` | Hard limit 120 characters. Shown on the share card. Derived from the first paragraph if missing. |
| `cover` | Always `./cover.png` (or `.jpg`). |
| `theme` | Optional. `default`, `green`, `orange`, or `ink`. |
| `collection` | Optional. Forces the 合集 name instead of keyword matching. |
| `source_url` | Optional. Becomes "阅读原文". |

## Shape

1. **Opening, 2 or 3 short lines.** State the conclusion or the conflict first. No warm-up.
2. **3 to 5 sections** with `## 1、小标题`. Each section makes one point.
3. **Author's view**, written apart from the facts.
4. **Ending, one line.** A stance, a real question to the reader, or the next topic.

## Paragraphs

- 1 to 3 sentences per paragraph. Leave a blank line between paragraphs.
- Spoken tone. Avoid report language such as "综上所述" or "值得注意的是".
- Bold one key sentence per section at most. Bold text takes the theme's accent color.
- Use `>` quotes for original words, data sources, or one punchline.

## Facts and opinions

| Type | Rule | Example |
|------|------|---------|
| Fact | Must come from the fact list, with a source | 「55% 的 token 消耗指向 AI 短剧」 |
| Rounded number | Allowed, but stay close to the source | 「近 3500 亿」 for 3497 亿 |
| Opinion | Phrase it as the author's view | 「我的判断是……」 |

Never invent percentages, prices, or quotes. Never paste a scraped headline as body text;
rewrite it in the author's voice.

## Forbidden ending

Never ask the reader for a metric. All of these are banned, in any wording:

- 点赞, 点个赞, 在看
- 转发, 分享一下, 扩散
- 让机器人识别, 让算法推荐, 涨阅读量

Scan the draft for these words before step 5. If you find one, delete the whole closing block,
not only the word.

## Layout mistakes to avoid

- `# 标题` at the top of the body: the title appears twice in WeChat.
- The author name inside the body: it is already under the title.
- Image references in the body: the cover is inserted automatically. Add extra images only when
  the user asks, as `![说明](./extra1.jpg)` next to `article.md`.
