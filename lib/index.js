/**
 * Host half of dsh-stock-quote: polls the public Tencent A-share quote API and
 * answers the client's read request with the latest snapshot.
 *
 * Why a host half: the quote data comes from an external HTTP endpoint
 * (qt.gtimg.cn). The host owns network access and a timer, so it fetches and
 * caches the latest snapshot; the client just asks for it and renders.
 *
 * The host → client channel is a single Package-private JSON method:
 *   client:  host.call('stockQuote.read', null)
 *   host:    ctx.harness.handle('stockQuote.read', fn)  → returns the snapshot
 * Only lossless JSON crosses the boundary.
 *
 * NOTE: this file runs in the HOST (Node) process, so it is plain ESM that
 * exports the Cordis plugin object directly — no `window.__ModuleLoader__`
 * wrapper (that is browser-only, used by the client half).
 *
 * @module dsh-stock-quote/host
 */

//#region config
/**
 * Watchlist: A-share index + individual stocks.
 * Tencent code format: sh/sz prefix + 6-digit code.
 */
const SYMBOLS = [
  'sh000300', // 沪深300
  'sz002185', // 华天科技
  'sh600521', // 华海药业
  'sh688825', // 长鑫科技
  'sh688836', // 宇树科技-W
  'sh600186', // 莲花控股
  'sh603222', // 济民健康
  'sz002506', // 协鑫集成
  'sz002050', // 三花智控
  'sz002177', // 御银股份
];
/** Poll interval (ms). 30s is plenty for a glanceable widget. */
const POLL_MS = 30000;
/** HTTP timeout per fetch (ms). */
const FETCH_TIMEOUT_MS = 8000;
//#endregion

//#region helpers
/**
 * Fetch the quote snapshot from the Tencent API.
 * @returns Promise resolving to an array of quote objects, or an empty
 *   array on any failure (the widget then keeps the last good data and
 *   marks the snapshot stale).
 */
/**
 * Decode the Tencent response body (GBK-encoded) to a UTF-8 string.
 * The API returns GBK bytes; `res.text()` would mis-decode the Chinese
 * names, so we read the bytes and decode them as GBK.
 * @param response - the fetch Response.
 * @returns UTF-8 decoded text.
 */
async function decodeGbk(response) {
  const buf = Buffer.from(await response.arrayBuffer());
  try {
    return new TextDecoder('gbk').decode(buf);
  } catch (error) {
    // GBK not supported by this TextDecoder build — fall back to UTF-8
    // (names may be garbled but prices/changes are still correct).
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function fetchQuotes() {
  const url = 'https://qt.gtimg.cn/q=' + SYMBOLS.join(',');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let text;
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await decodeGbk(res);
  } catch (error) {
    return [];
  } finally {
    clearTimeout(timer);
  }
  return parseQuotes(text);
}

/**
 * Parse the Tencent quote response (GBK-decoded text of `v_code="..."`
 * lines) into a clean array of quote objects.
 * @param text - raw response text.
 * @returns array of { code, name, price, prevClose, open, high, low,
 *   change, changePct, time }.
 */
function parseQuotes(text) {
  const out = [];
  if (!text) return out;
  const lines = text.split(';');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/v_(\w+)="(.*)"/);
    if (!m) continue;
    const code = m[1];
    const fields = m[2].split('~');
    if (fields.length < 35) continue;
    // Tencent field layout (0-based):
    //  1 = name, 3 = current price, 4 = prev close, 5 = open,
    //  30 = timestamp (YYYYMMDDHHMMSS), 31 = change, 32 = change %,
    //  33 = high, 34 = low.
    const name = fields[1];
    const price = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[4]);
    const open = parseFloat(fields[5]);
    const change = parseFloat(fields[31]);
    const changePct = parseFloat(fields[32]);
    const high = parseFloat(fields[33]);
    const low = parseFloat(fields[34]);
    const time = fields[30];
    if (!name || !isFinite(price)) continue;
    out.push({
      code,
      name,
      price,
      prevClose: isFinite(prevClose) ? prevClose : null,
      open: isFinite(open) ? open : null,
      high: isFinite(high) ? high : null,
      low: isFinite(low) ? low : null,
      change: isFinite(change) ? change : null,
      changePct: isFinite(changePct) ? changePct : null,
      time,
    });
  }
  return out;
}
//#endregion

//#region state
let latest = {
  quotes: [],
  fetchedAt: null,
  stale: true,
};
let timer = null;
let started = false;
//#endregion

function start() {
  if (started) return;
  started = true;
  // Immediate first fetch so the widget isn't empty on load.
  fetchQuotes().then((quotes) => {
    latest = { quotes, fetchedAt: Date.now(), stale: quotes.length === 0 };
  });
  timer = setInterval(() => {
    fetchQuotes().then((quotes) => {
      latest = { quotes, fetchedAt: Date.now(), stale: quotes.length === 0 };
    });
  }, POLL_MS);
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}

/** Client → Host: return the current quote snapshot (JSON-safe). */
function readSnapshot() {
  return {
    quotes: latest.quotes,
    fetchedAt: latest.fetchedAt,
    stale: latest.stale,
  };
}

//#region plugin
const name = 'dsh-stock-quote';

function apply(ctx) {
  const harness = ctx.harness;
  if (harness && typeof harness.handle === 'function') {
    harness.handle('stockQuote.read', () => readSnapshot());
  }
  start();
  // Clean up the timer on stop.
  ctx.effect(() => () => {
    stop();
  });
}

export { apply, name };
export default { name, apply };
