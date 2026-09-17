# one-star-one-cat

**Star this repo, get a random cat.** 一颗星，一只猫。

点一下右上角的 Star，大约 10 分钟内，一只随机小猫会自动送到你手上：仓库里会开一个 issue @ 你（你会收到 GitHub 站内通知），同时你的头像和那只猫会被钉在下方的猫咪墙上。

还想要？开一个新 issue，正文里写 `I need another cat`，机器人会直接在这个 issue 下面回你一只新的。

- 猫从 [cataas.com](https://cataas.com) 随机抓，免 key
- 每只猫都不一样，猫身上会写着 `thanks @你的名字`
- unstar 再 star 不会重发，别试了
- 点名要猫有冷却：同一个 issue 只回一次，每人 24 小时最多 3 只

## 猫咪墙

<!-- CATS_WALL_START -->
<a href="https://github.com/liplin221"><img src="https://avatars.githubusercontent.com/u/93197404?v=4&s=64" width="32" height="32" alt="liplin221" title="liplin221"></a>&nbsp;<img src="https://cataas.com/cat/says/thanks%20%40liplin221?width=600&random=1789630407697" width="96" alt="cat for liplin221">&nbsp;&nbsp;
<!-- CATS_WALL_END -->

## 我还想再要一只

三种方式，从最省事到最麻烦：

1. **在 issue 里喊一声**（推荐）：新开一个 issue，正文写 `I need another cat`（中文「再来一只猫」也认），机器人直接在这个 issue 下回你一只新猫。
2. **点名补发**：`Actions → one-star-one-cat → Run workflow`，在 `redeliver` 里填 GitHub 用户名，多个用逗号分隔。绕过名单直接送，也能给没 star 的朋友空投。
3. **手动清名单**：把 `data/seen_stargazers.json` 里自己那行删掉，commit 推上去，下一轮自动重送。

> 第 3 种只在「你是最后一个 star 的人」时才灵 —— 脚本是从最后一页往前扫 stargazers 的，连续两页没发现新人就停了。

## 它怎么工作的

GitHub Actions 没有「有人 star」这个事件（`on: watch` 不带具体用户），所以用定时轮询 + 增量比对来造出它：

**送猫（`cat-for-star.yml`，每 10 分钟）**

1. 调 stargazers 接口拿新星标 —— 接口按时间升序，新 star 在最后一页，所以先探总页数再从后往前翻
2. 和 `data/seen_stargazers.json` 比对，过滤出没送过的人
3. 抓一只猫 → 开 issue @ 他 → 头像和猫写进猫咪墙 → commit 回仓库

**点名要猫（`cat-on-demand.yml`，issue 创建时）**

1. issue 正文命中 `I need another cat` 之类触发词才继续
2. 这个 issue 已经回过就跳过；同一用户 24 小时内超过 3 只就礼貌拒绝
3. 生成猫 → 在 issue 下评论 → 记录冷却时间

两个流程共用 `scripts/cat-for-star.mjs`，靠有没有 `ISSUE_NUMBER` 区分模式。只有成功发出 issue 才会写进 seen 名单，所以中途失败不会丢猫，下一轮自动重试。

## 自己也搞一个

1. Fork 本仓库
2. **Settings → Actions → General → Workflow permissions → 选 `Read and write permissions`**
   （新仓库默认是只读，不改的话开 issue 和推 README 都会 403，这是最容易踩的坑）
3. Fork 的仓库 Actions 默认可能是关着的，去 Actions 页面点启用
4. 手动 `Run workflow` 跑一次，勾选 dry run 看日志，确认没问题再正式跑一次
5. **如果 fork 时仓库已经有 star**：手动 Run workflow，`max_per_run` 填一个比现有 star 数更大的值（比如 `500`），一次性把历史 star 全部补发完。

   猫咪墙是「每轮追加到末尾、轮内按时间正序」，所以只有一轮处理完所有历史 star，墙上的顺序才会是严格的时间正序；分多轮跑的话顺序会按批次倒过来。

之后就全自动了。可选配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_PER_RUN` | `20` | 单轮最多送几只，防止爆仓被限流。超出的下一轮补上 |
| `DELAY_MS` | `500` | 两次开 issue 之间的间隔，躲开 GitHub 次级限流 |
| `COOLDOWN_HOURS` | `24` | 点名要猫的冷却窗口 |
| `MAX_PER_USER` | `3` | 冷却窗口内每人最多要几只 |
| `DRY_RUN` | 空 | 设为 `1` 时只打印不实际发送 |
| `REQUEST_TIMEOUT_MS` | `8000` | 外部请求超时 |

`GH_TOKEN` 用 Actions 自带的 `secrets.GITHUB_TOKEN` 就够，不用额外配 PAT。而且用这个 token 开的 issue 不会再触发 workflow，天然不会死循环。

## 换成 AI 现画的猫（可选）

默认用 cataas 随机猫，零配置。想让每只猫都是 AI 现画的、以用户名为灵感，去 `Settings → Secrets and variables → Actions` 配两个东西：

- **Variables**（明文配置）：`IMAGE_PROVIDER=openai`，模型用 `IMAGE_MODEL` 改
- **Secrets**：`IMAGE_API_KEY`

接口是 OpenAI 兼容格式，所以智谱、硅基流动、混元这些只要把 `IMAGE_BASE_URL` 指过去也能用。prompt 模板可以用 `IMAGE_PROMPT` 覆盖，里面的 `{name}` 会替换成用户名。

两个注意点：

- 文生图返回的图片链接通常一两小时就失效，所以脚本会把图落盘到 `cats/` 再引用
- 生成失败会自动降级成随机猫，不会卡住流程

价格参考（2026-02）：GPT Image 1 Mini 约 $0.005/张，混元 Image 3.0 约 $0.030/张，GPT Image 1.5 约 $0.04/张。一千个 star 也就几美元，但记得设好 `MAX_PER_USER`，不然有人批量开 issue 能把账单刷穿。

## 两个提醒

- 仓库 **60 天没有任何活动**，GitHub 会自动禁用定时任务。仓库刚建、提交少的时候要留意，发现停了就手动 `Run workflow` 一次唤醒。
- cron 用的是 **UTC 时间**，且高峰期可能延迟几分钟，这是 GitHub 的正常行为，不是脚本卡了。

## License

MIT
