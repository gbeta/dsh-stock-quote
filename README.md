# dsh-stock-quote

A-share 实时行情小组件，钉在 DSH Web GUI 上，可拖拽、可折叠。

- **折叠态**：一行紧凑显示所有标的 价格 + 涨跌幅（红涨绿跌）。
- **展开态**：每个标的一行（名称 / 价格 / 涨跌幅），底部显示更新时间。
- 默认盯 **沪深300** + 9 只个股（华天科技、华海药业、长鑫科技、宇树科技-W、莲花控股、济民健康、协鑫集成、三花智控、御银股份），可在 `lib/index.js` 的 `SYMBOLS` 里改。
- 数据来自腾讯公开行情接口（`qt.gtimg.cn`），host 侧每 30s 拉一次，client 侧只渲染。
- 位置、展开/折叠状态都记在 `localStorage`，跨会话保留。

## 安装

```sh
# 在 DSH 工作区的 package.json 里加：
#   "dependencies": { "dsh-stock-quote": "link:./dsh-stock-quote" }
# 然后：
pnpm install
```

或从 GitHub：

```sh
dsh plugin add gbeta/dsh-stock-quote
```

## 结构

- `lib/index.js` — host 半：轮询行情接口、缓存最新快照、通过 `harness.handle('stockQuote.read')` 暴露给 client。
- `lib/client.js` — client 半：`shell.overlay` 槽里的可拖拽可折叠 widget，每 30s 调 `host.call('stockQuote.read')` 取数据。
- `cordis.patch.yml` — 插件注册。

## 自定义

改 `lib/index.js` 顶部：

- `SYMBOLS` — 要盯的代码（`sh`/`sz` 前缀 + 6 位代码）。
- `POLL_MS` — 刷新间隔（默认 30000）。

## 为什么是 host + client 两半

行情数据来自**外部网络请求**（`qt.gtimg.cn`），浏览器半不能直接拉（跨域 + 不想 把 请求 暴露 给 页面），所以：

- **host 半**（`lib/index.js`）：拥有 网络 和 定时器，每 30s 拉 一次 行情，缓存 最新 快照，通过 `harness.handle('stockQuote.read')` 暴露 给 client。
- **client 半**（`lib/client.js`）：只 渲染，每 30s 调 `host.call('stockQuote.read')` 取 数据。

这 比 纯 浏览器 的 dsh-token-speed 多 一 个 host 半，但 结构 一样。

## 使用

装 完 刷新 页面，屏幕 右下 角 会 出现 一 行 行情。

- **点击** 卡片（或 点 `+`/`−` 按钮）：展开/收起 详情 面板。
- **拖动** 卡片：移到 任意 位置，位置 记 住。
- 展开 面板 底部 显示 更新时间，30s 自动 刷新。

## 故障 排查

- **显示「获取失败，稍后重试」**：host 拉 行情 接口 失败（网络/接口 限流）。widget 保留 上次 数据，30s 后 自动 重试，不会 崩。
- **数据 不 变**：非 交易 时段 接口 仍 返回 最近 收盘 数据，所以 价格 不 动 是 正常 的。
- **想 换 标的**：改 `lib/index.js` 顶部 的 `SYMBOLS` 数组（`sh`/`sz` 前缀 + 6 位 代码），刷新 页面。
