/**
 * Client half of dsh-stock-quote: a collapsible, draggable A-share quote
 * widget pinned to the shell.
 *
 * Collapsed: a single compact line of the tracked prices + change %.
 * Expanded:  one row per symbol (name, price, change, change %) with a
 *            refresh timestamp.
 *
 * Data: the client polls the host half (`host.call('stockQuote.read')`)
 * every 30s. The host owns the network fetch; the client only renders.
 *
 * @module dsh-stock-quote/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-stock-quote',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useRef = React.useRef;
    var useCallback = React.useCallback;

    //#region CSS
    var CSS_ID = 'dsh-stock-quote/widget.css';
    var CSS =
      '.dsq-root{position:absolute;z-index:5;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}' +
      '.dsq-root *{box-sizing:border-box}' +
      '.dsq-card{display:flex;align-items:center;gap:8px;padding:7px 11px;border-radius:12px;' +
      'background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));' +
      'box-shadow:0 6px 22px rgba(0,0,0,.16);color:var(--dsw-alias-label-primary,#111);' +
      'cursor:grab;user-select:none;transition:box-shadow .18s ease;max-width:min(92vw,560px)}' +
      '.dsq-card:hover{box-shadow:0 8px 28px rgba(0,0,0,.22)}' +
      '.dsq-card[data-dragging=true]{cursor:grabbing;box-shadow:0 12px 32px rgba(0,0,0,.28)}' +
      '.dsq-toggle{flex:0 0 auto;width:20px;height:20px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));' +
      'background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.04));color:var(--dsw-alias-label-secondary,#555);' +
      'display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1;cursor:pointer;padding:0}' +
      '.dsq-toggle:hover{background:var(--dsw-alias-bg-layer-4,rgba(0,0,0,.08))}' +
      '.dsq-line{display:flex;align-items:baseline;gap:10px;overflow:hidden;white-space:nowrap}' +
      '.dsq-item{display:flex;align-items:baseline;gap:4px;font-size:11px;white-space:nowrap}' +
      '.dsq-item .n{color:var(--dsw-alias-label-tertiary,#999);font-size:10px}' +
      '.dsq-item .p{font-weight:650;color:var(--dsw-alias-label-primary,#111)}' +
      '.dsq-item .c{font-size:10px;font-weight:600}' +
      '.dsq-item .c[data-up=true]{color:#ef4444}' +
      '.dsq-item .c[data-down=true]{color:#22c55e}' +
      '.dsq-item .c[data-flat=true]{color:var(--dsw-alias-label-tertiary,#999)}' +
      '.dsq-panel{margin-top:6px;width:248px;padding:9px 11px;border-radius:12px;' +
      'background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));' +
      'box-shadow:0 8px 26px rgba(0,0,0,.18);cursor:default}' +
      '.dsq-rows{display:flex;flex-direction:column;gap:6px}' +
      '.dsq-row{display:flex;align-items:baseline;gap:8px;font-size:11px}' +
      '.dsq-row .nm{flex:1 1 auto;color:var(--dsw-alias-label-primary,#111);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.dsq-row .px{flex:0 0 auto;font-weight:650;color:var(--dsw-alias-label-primary,#111);font-variant-numeric:tabular-nums}' +
      '.dsq-row .ch{flex:0 0 auto;font-size:10px;font-weight:600;font-variant-numeric:tabular-nums}' +
      '.dsq-row .ch[data-up=true]{color:#ef4444}' +
      '.dsq-row .ch[data-down=true]{color:#22c55e}' +
      '.dsq-row .ch[data-flat=true]{color:var(--dsw-alias-label-tertiary,#999)}' +
      '.dsq-foot{margin:8px 0 0;font-size:10px;line-height:1.35;color:var(--dsw-alias-label-tertiary,#999);' +
      'border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));padding-top:6px}' +
      '.dsq-foot[data-stale=true]{color:#ef4444}';
    function injectCss() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css=' + JSON.stringify(CSS_ID) + ']') !== null) return;
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-stock-quote';
      tag.dataset.pluginCss = CSS_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region constants
    var INJECT = ['slots'];
    var STORE_KEY = 'dsh-stock-quote:prefs:v1';
    var MARGIN = 16;
    var POLL_MS = 30000;
    //#endregion

    //#region helpers
    function clamp(v, lo, hi) {
      return v < lo ? lo : v > hi ? hi : v;
    }

    function loadPrefs() {
      var fallback = { x: null, y: null, open: false };
      try {
        var raw = window.localStorage.getItem(STORE_KEY);
        if (!raw) return fallback;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return fallback;
        return {
          x: typeof parsed.x === 'number' ? parsed.x : null,
          y: typeof parsed.y === 'number' ? parsed.y : null,
          open: parsed.open === true,
        };
      } catch (error) {
        return fallback;
      }
    }

    function savePrefs(prefs) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
      } catch (error) {
        /* storage disabled */
      }
    }

    function fmtPrice(p) {
      if (typeof p !== 'number' || !isFinite(p)) return '—';
      if (p >= 1000) return p.toFixed(0);
      if (p >= 100) return p.toFixed(1);
      return p.toFixed(2);
    }

    function fmtChange(pct) {
      if (typeof pct !== 'number' || !isFinite(pct)) return '—';
      var sign = pct > 0 ? '+' : '';
      return sign + pct.toFixed(2) + '%';
    }

    function changeDir(pct) {
      if (typeof pct !== 'number' || !isFinite(pct) || pct === 0) return 'flat';
      return pct > 0 ? 'up' : 'down';
    }

    function fmtTime(ms) {
      if (!ms) return '—';
      var d = new Date(ms);
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    }
    //#endregion

    //#region widget
    function createWidget(ctx) {
      return function StockQuoteWidget() {
        var host = ctx.host;

        var [snap, setSnap] = useState(null);
        var [error, setError] = useState(false);

        // Poll the host for the latest quote snapshot.
        useEffect(function () {
          var cancelled = false;
          var id = null;
          function tick() {
            if (!host || typeof host.call !== 'function') return;
            host
              .call('stockQuote.read', null)
              .then(function (data) {
                if (cancelled || !data) return;
                setSnap(data);
                setError(false);
              })
              .catch(function () {
                if (cancelled) return;
                setError(true);
              });
          }
          tick();
          id = window.setInterval(tick, POLL_MS);
          return function () {
            cancelled = true;
            if (id) window.clearInterval(id);
          };
        }, [host]);

        var prefsRef = useRef(null);
        if (prefsRef.current === null) prefsRef.current = loadPrefs();
        var [open, setOpen] = useState(prefsRef.current.open);
        var [pos, setPos] = useState({ x: prefsRef.current.x, y: prefsRef.current.y });
        var [dragging, setDragging] = useState(false);

        var dragRef = useRef(null);
        var rootRef = useRef(null);

        var onPointerDown = useCallback(function (event) {
          if (event.button !== 0) return;
          var node = rootRef.current;
          if (!node) return;
          var rect = node.getBoundingClientRect();
          dragRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            originLeft: rect.left,
            originTop: rect.top,
            width: rect.width,
            height: rect.height,
            moved: false,
          };
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch (error) {
            /* capture unsupported */
          }
        }, []);

        var onPointerMove = useCallback(
          function (event) {
            var drag = dragRef.current;
            if (!drag) return;
            var dx = event.clientX - drag.startX;
            var dy = event.clientY - drag.startY;
            if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
            if (!drag.moved) {
              drag.moved = true;
              setDragging(true);
            }
            var maxX = window.innerWidth - drag.width - 4;
            var maxY = window.innerHeight - drag.height - 4;
            var left = clamp(drag.originLeft + dx, 4, Math.max(4, maxX));
            var top = clamp(drag.originTop + dy, 4, Math.max(4, maxY));
            setPos({ x: left, y: top });
          },
          [setPos, setDragging]
        );

        var onPointerUp = useCallback(
          function (event) {
            var drag = dragRef.current;
            dragRef.current = null;
            setDragging(false);
            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch (error) {
              /* not captured */
            }
            if (drag && !drag.moved) {
              // A press that never moved is a click: toggle the panel.
              setOpen(function (prev) {
                prefsRef.current.open = !prev;
                savePrefs(prefsRef.current);
                return !prev;
              });
            } else if (drag && drag.moved) {
              prefsRef.current.x = pos.x;
              prefsRef.current.y = pos.y;
              savePrefs(prefsRef.current);
            }
          },
          [pos.x, pos.y, setOpen]
        );

        useEffect(function () {
          function onResize() {
            setPos(function (prev) {
              if (prev.x === null || prev.y === null) return prev;
              var node = rootRef.current;
              if (!node) return prev;
              var rect = node.getBoundingClientRect();
              var maxX = window.innerWidth - rect.width - 4;
              var maxY = window.innerHeight - rect.height - 4;
              var next = { x: clamp(prev.x, 4, Math.max(4, maxX)), y: clamp(prev.y, 4, Math.max(4, maxY)) };
              if (next.x === prev.x && next.y === prev.y) return prev;
              prefsRef.current.x = next.x;
              prefsRef.current.y = next.y;
              savePrefs(prefsRef.current);
              return next;
            });
          }
          window.addEventListener('resize', onResize);
          return function () {
            window.removeEventListener('resize', onResize);
          };
        }, [setPos]);

        var style =
          pos.x === null || pos.y === null
            ? { right: MARGIN, bottom: MARGIN }
            : { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' };

        var quotes = (snap && snap.quotes) || [];
        var stale = snap && snap.stale;

        // Collapsed line: name + price + change for each symbol.
        var lineItems = quotes.map(function (q) {
          var dir = changeDir(q.changePct);
          var changeProps = { className: 'c' };
          changeProps['data-' + dir] = 'true';
          return h(
            'span',
            { key: q.code, className: 'dsq-item' },
            h('span', { className: 'n' }, q.name),
            h('span', { className: 'p' }, fmtPrice(q.price)),
            h('span', changeProps, fmtChange(q.changePct))
          );
        });

        // Expanded rows.
        var rows = quotes.map(function (q) {
          var dir = changeDir(q.changePct);
          var chProps = { className: 'ch' };
          chProps['data-' + dir] = 'true';
          return h(
            'div',
            { key: q.code, className: 'dsq-row' },
            h('span', { className: 'nm', title: q.name }, q.name),
            h('span', { className: 'px' }, fmtPrice(q.price)),
            h('span', chProps, fmtChange(q.changePct))
          );
        });

        var footText = error
          ? '获取失败，稍后重试'
          : stale
            ? '暂无数据'
            : '更新于 ' + fmtTime(snap.fetchedAt) + ' · 30s 自动刷新';

        return h(
          'div',
          { ref: rootRef, className: 'dsq-root', style: style },
          h(
            'div',
            {
              className: 'dsq-card',
              'data-dragging': dragging ? 'true' : 'false',
              title: '拖动移动位置 · 点击展开/收起',
              onPointerDown: onPointerDown,
              onPointerMove: onPointerMove,
              onPointerUp: onPointerUp,
              onPointerCancel: onPointerUp,
            },
            h(
              'button',
              {
                className: 'dsq-toggle',
                type: 'button',
                'aria-label': open ? '收起' : '展开',
                onPointerDown: function (e) {
                  e.stopPropagation();
                },
                onClick: function (e) {
                  e.stopPropagation();
                  setOpen(function (prev) {
                    prefsRef.current.open = !prev;
                    savePrefs(prefsRef.current);
                    return !prev;
                  });
                },
              },
              open ? '−' : '+'
            ),
            h('div', { className: 'dsq-line' }, lineItems.length > 0 ? lineItems : h('span', { className: 'n' }, '…'))
          ),
          open
            ? h(
                'div',
                { className: 'dsq-panel' },
                h('div', { className: 'dsq-rows' }, rows.length > 0 ? rows : h('div', { className: 'dsq-row' }, h('span', { className: 'nm' }, '加载中…'))),
                h('p', { className: 'dsq-foot', 'data-stale': stale || error ? 'true' : 'false' }, footText)
              )
            : null
        );
      };
    }
    //#endregion

    function apply(ctx) {
      injectCss();
      var Widget = createWidget(ctx);
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-stock-quote', order: 110, label: 'Stock quote' },
          Widget
        );
      });
    }

    module.exports = {
      name: 'dsh-stock-quote',
      inject: INJECT,
      apply: apply,
    };
    return module.exports;
  },
});
