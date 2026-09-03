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

## 说明

- 行情数据是**外部网络请求**，所以本插件是 host + client 两半（比纯浏览器的 dsh-token-speed 多一个 host 半）。
- 网络失败时 widget 保留上次数据并标红提示，不会崩。
- 非交易时段接口仍返回最近收盘数据。
