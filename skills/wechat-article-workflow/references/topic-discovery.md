# Topic Discovery

Goal: leave this step with one topic, one angle, and a fact list the draft can rely on.

## 1. Scan the radar

```bash
node <skill-dir>/scripts/wxpub.mjs topics --limit 10 --out output/<today>/topics.md
```

| Source name | What it shows | Good for |
|-------------|---------------|----------|
| `zhihu` | 知乎热榜 questions with heat | Debates, opinions, "how to see this" angles |
| `baidu` | 百度热搜 | Mass-market news |
| `v2ex` | V2EX hot threads | Developers, careers, tools |
| `sspai` | 少数派 feed | Apps, productivity, digital life |
| `hackernews` | Hacker News front page | Technology and startups, early signals |
| `github` | Repositories created in the last 7 days, by stars | Open-source tools worth a review |
| `producthunt` | Product Hunt feed (not in the default set) | New products |
| `google-trends` | Google daily trends, `--geo US` (not in the default set) | Overseas hot searches |

Add any feed with `--rss <url>[,<url>]`. A source that fails prints a warning; the others still run.
Hot lists change their format without notice. If one source keeps failing, use web search instead.

## 2. Shortlist with the user

Pick 3 candidates that fit the account's niche. For each one, write three lines:

- **Angle**: the one sentence the article argues. A topic is not an angle.
  "AI 短剧" is a topic. "AI 短剧烧掉了一半的 token，但赚钱的不是做剧的人" is an angle.
- **Reader**: who opens it and what they get.
- **Why now**: the trigger in the last 48 hours.

Let the user choose. Prefer the candidate where the author has first-hand experience.

## 3. Gather facts

Use web search on the chosen topic. Keep 3 to 5 facts, each with:

- the claim, with the number
- the source name and the date

If a number goes into the article, it comes from this list or a fresh fetch, never from memory.
Write the date of every "today" claim, because drafts often sit in the box for a day.

## 4. Hand-off to writing

Pass three things to the writing step: the angle, the reader, and the fact list.
