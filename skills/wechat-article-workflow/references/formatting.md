# Formatting (排版)

The WeChat editor drops `<style>` tags and `class` attributes. The renderer writes every style
inline, so the draft looks the same as the preview.

## Themes

| Theme | Second-level heading | Accent | Use for |
|-------|---------------------|--------|---------|
| `default` | Blue left bar | `#1e90ff` | Technology, general |
| `green` | WeChat green left bar | `#07c160` | Life, health, tutorials |
| `orange` | Orange underline | `#ff6a00` | Business, marketing |
| `ink` | Black, centered | `#333333` | Long essays, stories |

All themes share 16px body text, 1.8 line height, and the same list, quote, and code styles.
The accent color goes to headings, bold text, and the quote bar.

Choose a theme, in priority order:

1. `--theme <name>` on `render`
2. `theme:` in the article frontmatter
3. `THEME=` in `.wxpub/.env`
4. `default`

To add a theme, add one entry to `THEMES` in `lib/markdown.mjs`.

## Preview

```bash
node <skill-dir>/scripts/wxpub.mjs render output/<today> --preview
```

This writes `preview.html`: a 375px-wide page with the title, the cover, the body, and the
end-of-article block. Open it in a browser. `render` without `--preview` prints the bare HTML
fragment; `--out file.html` saves it.

## Supported Markdown

| Markdown | Result |
|----------|--------|
| `## 1、小标题` | Second-level heading in theme style |
| `### 小节` | Third-level heading in the accent color |
| `**粗体**`, `*斜体*` | Bold in the accent color, italic |
| `- item`, `1. item` | Lists |
| `> quote` | Quote block with an accent bar |
| `` `code` `` and fenced code | Code, HTML-escaped |
| `[text](https://...)` | Link (see the link rules below) |
| `![alt](./x.jpg)` | Body image, uploaded to WeChat at publish time |
| `---` | Divider |
| `<!-- note -->` | Removed. Use it for notes to yourself |

Tables and nested lists are not supported. WeChat renders them badly on phones; use short
paragraphs instead.

## Link rules

- External links work.
- Links to other WeChat articles must be the long form
  `https://mp.weixin.qq.com/s?__biz=...&mid=...&idx=...&sn=...`.
  The short form `https://mp.weixin.qq.com/s/<id>` makes the drafts interface fail with 45166.
- To turn a short link into a long one, open it in a browser and copy the address after redirect.

## End-of-article block

Added automatically after the body when `ARTICLE_FOOTER_ENABLED=true`:

1. **往期文章精选**: from `.wxpub/past-articles.json`, newest first, at most `PAST_ARTICLES_LIMIT`.
   `PAST_ARTICLES_LINK_MODE=text` (default) shows titles only, which never fails.
   `link` adds links and checks them before any upload.
2. **Self-introduction**: any Markdown in `.wxpub/footer.md`.
3. **Account card**: set `PROFILE_CARD_ID` to the account's `__biz` value to get the native
   WeChat card. Without it, an HTML card is built from `PROFILE_NICKNAME`,
   `PROFILE_SIGNATURE`, and `PROFILE_HEADIMG`.

```bash
node <skill-dir>/scripts/wxpub.mjs past add --title "标题" --url "<long link>"
node <skill-dir>/scripts/wxpub.mjs footer   # preview the block
```

The footer holds the self-introduction and the past-article list only. Never put an engagement
request there.
