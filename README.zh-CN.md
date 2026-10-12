# 微信公众号写作全流程 Skill

<p align="center">
  <a href="./README.md">English</a> | <strong>中文</strong>
</p>

> **这套自动化工作流已经帮我的公众号涨粉 5000。**

一个给 AI 助手用的 Skill，把公众号写作的完整流程串起来：

```text
选题雷达 → 切入角度与事实清单 → 大纲 → article.md → 封面图
        → 主题排版 → 手机宽度预览 → 公众号草稿箱
```

你只需要跟 AI 说一句「帮我写一篇关于 X 的公众号文章」。Skill 告诉 AI 每一步该做什么，
自带的零依赖 Node.js 命令行工具 `wxpub` 负责干体力活：抓热榜、渲染内联样式的 HTML、上传图片、建草稿。

**默认绝不会替你群发。** 流程停在草稿箱，最后的「发表」由你自己点。

## 能做什么

| 环节 | 效果 |
|------|------|
| 找选题 | `wxpub topics` 一键抓知乎热榜、百度热搜、V2EX、少数派、Hacker News、GitHub 新星项目，可选 Product Hunt、Google Trends，也能加任意订阅源。免登录，不用任何密钥。 |
| 写稿 | 内置标题、开头、短段落、事实与观点分开写的规则，并禁止「点赞转发让机器人识别」式的结尾。 |
| 封面 | 每篇只做一张 16:9 封面，同时用作草稿封面和正文首图。可用 kie.ai 生成，也可以用你自己的图。 |
| 排版 | 4 套主题：`default`（蓝色左边框）、`green`（微信绿）、`orange`（橙色下划线）、`ink`（黑白居中，适合长文）。全部是内联样式，粘进公众号编辑器不会丢。 |
| 预览 | `wxpub render --preview` 生成 375px 宽的 `preview.html`，和手机上看到的一致。 |
| 进草稿箱 | 自动上传封面和正文图、创建草稿，并列出微信接口设不了的 4 项（原创、赞赏、合集、智能插入广告）该怎么选。 |
| 文末区块 | 每篇自动附上「往期文章精选」、自我介绍和公众号名片。 |
| 通知 | 可选：草稿进箱后发飞书消息，附摘要和待办，适合定时任务。 |
| 测试 | 200 多项离线测试，用本地模拟的微信服务器跑：`npm test`。 |

## 需要准备

- 一个支持 Skill 的 AI 助手：[Claude Code](https://claude.com/claude-code)，或任何能读 `SKILL.md` 的助手
- Node.js 18 或更高版本（不需要 `npm install`）
- 只有「进草稿箱」这一步需要：公众号的 AppID、AppSecret，以及在 IP 白名单里加上你电脑的公网地址
- 可选：[kie.ai](https://kie.ai/api-key) 的密钥（生成封面），飞书自建应用（发通知）

从选题到预览的前 5 步，不需要任何账号。

## 安装

### 方式一：Claude Code 插件

```text
/plugin marketplace add cl-victor1/wechat-article-workflow-skill
/plugin install wechat-article-workflow@wechat-article-workflow-skill
```

### 方式二：`skills` 命令行（支持多种 AI 助手）

```bash
npx skills add cl-victor1/wechat-article-workflow-skill
```

### 方式三：直接复制文件夹

```bash
git clone https://github.com/cl-victor1/wechat-article-workflow-skill.git
mkdir -p ~/.claude/skills
cp -r wechat-article-workflow-skill/skills/wechat-article-workflow ~/.claude/skills/
```

装好后重启一下 AI 助手。

## 快速上手

新建一个放文章的文件夹，在里面打开 AI 助手：

```bash
mkdir my-wechat && cd my-wechat
claude
```

然后直接说：

> 用 wechat-article-workflow 帮我找今天的选题，写一篇公众号文章，排版后放进草稿箱

AI 会依次：运行 `wxpub init` 建好目录，给你看今天的热榜，和你商量切入角度，写稿，做封面，
给你看预览，最后建草稿。

### 填写公众号信息（只需一次）

`wxpub init` 会生成 `.wxpub/.env`，至少填这三项：

```env
WECHAT_APP_ID=wx...
WECHAT_APP_SECRET=...
WECHAT_AUTHOR=你的笔名
```

1. 打开 [mp.weixin.qq.com](https://mp.weixin.qq.com/) → 设置与开发 → 基本配置。
2. 复制 AppID；重置并复制 AppSecret（只显示一次）。
3. 把你电脑的公网地址（终端运行 `curl -s https://ifconfig.me` 可以看到）加进「IP 白名单」。
4. 运行 `wxpub doctor --online`，看到「access_token 获取成功」就对了。

想在多个项目里共用，就把配置写进 `~/.wxpub/.env`。`.wxpub/` 目录千万不要提交到 Git。

## 直接用命令行

```bash
WXPUB="node ~/.claude/skills/wechat-article-workflow/scripts/wxpub.mjs"

$WXPUB init                                   # 建 .wxpub/ 和今天的文章目录
$WXPUB topics --out output/2026-10-12/topics.md
$WXPUB cover output/2026-10-12                # 需要 KIE_API_KEY
$WXPUB render output/2026-10-12 --theme ink --preview
$WXPUB publish output/2026-10-12 --dry-run    # 只校验，不发任何请求
$WXPUB publish output/2026-10-12              # 建草稿
```

`$WXPUB --help` 可以看到全部命令。

## 仓库结构

```text
.claude-plugin/                 插件与插件市场清单
skills/wechat-article-workflow/
├─ SKILL.md                     AI 照着执行的流程
├─ references/                  选题、写作、封面、排版、发布五份说明
├─ scripts/wxpub.mjs            命令行入口
├─ lib/                         渲染器、微信客户端、选题雷达、文末区块、飞书
├─ templates/                   .env、文章、文末、合集模板
└─ test/                        离线测试与模拟微信服务器
```

## 常见问题

**会不会自动群发？**
不会。默认模式是 `draft_only`，只进草稿箱。`api_freepublish` 是实验功能，默认关闭。

**为什么只做一张图？**
大多数文章一张好封面就够了，流程也快。确实需要多图时，在正文里写 `![](./extra.jpg)` 就行。

**原创、赞赏、合集为什么不能自动设置？**
微信官方草稿接口没有这些字段。工具会把该选什么打印出来，你在点「发表」前花 10 秒设好即可。

**报错 45166 怎么办？**
文章或往期列表里有 `mp.weixin.qq.com/s/xxxx` 这样的短链接。换成带 `?__biz=...&mid=...&idx=...&sn=...` 的长链接。

**报错 40164 怎么办？**
你的公网地址变了，把新地址加进 IP 白名单。

## 许可证

MIT
