# one-star-one-cat

**Star this repo, get a random cat.** 一颗星，一只猫。

点一下右上角的 Star，大约 10 分钟内，一只随机小猫会自动送到你手上：仓库里会开一个 issue @ 你（你会收到 GitHub 站内通知），同时你的头像和那只猫会被钉在下方的猫咪墙上。

- 猫从 [cataas.com](https://cataas.com) 随机抓，免 key
- 每只猫都不一样，猫身上会写着 `thanks @你的名字`
- unstar 再 star 不会重发，别试了

## 猫咪墙

<!-- CATS_WALL_START -->
<!-- CATS_WALL_END -->

## 它怎么工作的

GitHub Actions 没有「有人 star」这个触发事件（`on: watch` 不带具体用户），所以用定时轮询 + 增量比对来造出这个事件：

1. 每 10 分钟跑一次 `scripts/cat-for-star.mjs`
2. 调 stargazers 接口拿新星标 —— 接口按时间升序，新 star 在最后一页，所以先探总页数再从后往前翻
3. 和 `data/seen_stargazers.json` 比对，过滤出没送过的人
4. 抓一只猫 → 开 issue @ 他 → 把头像和猫写进上面的墙 → commit 回仓库

只有成功发出 issue 才会写进 seen 名单，所以中途失败不会丢猫，下一轮自动重试。

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
| `DRY_RUN` | 空 | 设为 `1` 时只打印不实际发送 |
| `REQUEST_TIMEOUT_MS` | `8000` | 外部请求超时 |

`GH_TOKEN` 用 Actions 自带的 `secrets.GITHUB_TOKEN` 就够，不用额外配 PAT。而且用这个 token 开的 issue 不会再触发 workflow，天然不会死循环。

## 两个提醒

- 仓库 **60 天没有任何活动**，GitHub 会自动禁用定时任务。仓库刚建、提交少的时候要留意，发现停了就手动 `Run workflow` 一次唤醒。
- cron 用的是 **UTC 时间**，且高峰期可能延迟几分钟，这是 GitHub 的正常行为，不是脚本卡了。

## License

MIT
