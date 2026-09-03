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
 *   host:    harness.handle('stockQuote.read', fn)  → returns the snapshot
 * Only lossless JSON crosses the boundary.
 *
 * @module dsh-stock-quote/host
 */
window.__ModuleLoader__.load({
  id: 'dsh-stock-quote',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    //#region config
    /**
     * Watchlist: A-share index + individual stocks.
     * Tencent code format: sh/sz prefix + 6-digit code.
     */
    var SYMBOLS = [
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
    var POLL_MS = 30000;
    /** HTTP timeout per fetch (ms). */
    var FETCH_TIMEOUT_MS = 8000;
    //#endregion

    //#region helpers
    /**
     * Fetch the quote snapshot from the Tencent API.
     * @returns Promise resolving to an array of quote objects, or an empty
     *   array on any failure (the widget then keeps the last good data and
     *   marks the snapshot stale).
     */
    async function fetchQuotes() {
      var url = 'https://qt.gtimg.cn/q=' + SYMBOLS.join(',');
      var controller = new AbortController();
      var timer = setTimeout(function () {
        controller.abort();
      }, FETCH_TIMEOUT_MS);
      var text;
      try {
        var res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        text = await res.text();
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
      var out = [];
      if (!text) return out;
      var lines = text.split(';');
      for (var i = 0; i < lines.length; i += 1) {
        var line = lines[i].trim();
        if (!line) continue;
        var m = line.match(/v_(\w+)="(.*)"/);
        if (!m) continue;
        var code = m[1];
        var fields = m[2].split('~');
        if (fields.length < 35) continue;
        // Tencent field layout (0-based):
        //  1 = name, 3 = current price, 4 = prev close, 5 = open,
        //  30 = timestamp (YYYYMMDDHHMMSS), 31 = change, 32 = change %,
        //  33 = high, 34 = low.
        var name = fields[1];
        var price = parseFloat(fields[3]);
        var prevClose = parseFloat(fields[4]);
        var open = parseFloat(fields[5]);
        var change = parseFloat(fields[31]);
        var changePct = parseFloat(fields[32]);
        var high = parseFloat(fields[33]);
        var low = parseFloat(fields[34]);
        var time = fields[30];
        if (!name || !isFinite(price)) continue;
        out.push({
          code: code,
          name: name,
          price: price,
          prevClose: isFinite(prevClose) ? prevClose : null,
          open: isFinite(open) ? open : null,
          high: isFinite(high) ? high : null,
          low: isFinite(low) ? low : null,
          change: isFinite(change) ? change : null,
          changePct: isFinite(changePct) ? changePct : null,
          time: time,
        });
      }
      return out;
    }
    //#endregion

    //#region state
    var latest = {
      quotes: [],
      fetchedAt: null,
      stale: true,
    };
    var timer = null;
    var started = false;
    //#endregion

    function start() {
      if (started) return;
      started = true;
      // Immediate first fetch so the widget isn't empty on load.
      fetchQuotes().then(function (quotes) {
        latest = { quotes: quotes, fetchedAt: Date.now(), stale: quotes.length === 0 };
      });
      timer = setInterval(function () {
        fetchQuotes().then(function (quotes) {
          latest = { quotes: quotes, fetchedAt: Date.now(), stale: quotes.length === 0 };
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

    var plugin = {
      name: 'dsh-stock-quote',
      apply: function apply(ctx) {
        var harness = ctx.harness;
        if (harness && typeof harness.handle === 'function') {
          harness.handle('stockQuote.read', function () {
            return readSnapshot();
          });
        }
        start();
        // Clean up the timer on stop.
        ctx.effect(function () {
          return function () {
            stop();
          };
        });
      },
    };
    module.exports = plugin;
    return module.exports;
  },
});
