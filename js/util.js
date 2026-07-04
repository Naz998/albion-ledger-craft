// Craft Ledger — small shared helpers (no modules: everything hangs off window.*)
'use strict';

window.UTIL = (function () {

  function fmtSilver(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const neg = n < 0; const a = Math.abs(n);
    let s;
    if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'm';
    else if (a >= 1e4) s = (a / 1e3).toFixed(1) + 'k';
    else s = Math.round(a).toLocaleString('en-US');
    return (neg ? '−' : '') + s;
  }

  function fmtSilverFull(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const neg = n < 0;
    return (neg ? '−' : '') + Math.round(Math.abs(n)).toLocaleString('en-US');
  }

  function fmtPct(x, digits) {
    if (x === null || x === undefined || !isFinite(x)) return '—';
    return (x * 100).toFixed(digits === undefined ? 1 : digits) + '%';
  }

  // el('div', {class:'a', onclick:fn}, child1, 'text', ...)
  function el(tag, attrs) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2), v);
        } else if (k === 'html') {
          node.innerHTML = v;
        } else {
          node.setAttribute(k === 'class' ? 'class' : k, v === true ? '' : v);
        }
      }
    }
    for (let i = 2; i < arguments.length; i++) {
      const c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(x => x && node.append(x));
      else node.append(c);
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  }

  function hoursAgo(isoDate) {
    if (!isoDate) return Infinity;
    // AODP timestamps are UTC without a zone suffix
    const t = Date.parse(isoDate.endsWith('Z') ? isoDate : isoDate + 'Z');
    if (isNaN(t)) return Infinity;
    return (Date.now() - t) / 36e5;
  }

  function fmtAge(isoDate) {
    const h = hoursAgo(isoDate);
    if (!isFinite(h)) return 'no data';
    if (h < 1) return Math.max(1, Math.round(h * 60)) + 'm ago';
    if (h < 48) return Math.round(h) + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  return { fmtSilver, fmtSilverFull, fmtPct, el, clear, debounce, hoursAgo, fmtAge };
})();
