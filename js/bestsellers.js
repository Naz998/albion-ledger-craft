// Craft Ledger — Best Sellers page: scan the catalog, rank by craft-to-sell profit.
'use strict';

(function () {
  const { el, clear, fmtSilver, fmtPct, hoursAgo } = UTIL;
  const D = window.CRAFT_LEDGER_DATA;

  const PAGE_SIZE = 50;
  let results = [];        // evaluated rows
  let noData = 0;
  let shown = PAGE_SIZE;
  let sortKey = 'profit';
  let sortDir = -1;
  let scanning = false;
  let scanQueued = false;
  let hideOutliers = true;

  const root = document.getElementById('app');

  // ------------------------------------------------------------ filters ----
  function filters() { return STATE.get('filters'); }
  function setFilter(k, v) {
    const f = Object.assign({}, filters());
    f[k] = v;
    STATE.set('filters', f);
  }

  function buildFilterBar() {
    const f = filters();

    const tierSel = el('select', { id: 'f-tier' }, el('option', { value: 'all' }, 'All tiers'));
    for (let t = 2; t <= 8; t++) tierSel.append(el('option', { value: String(t), selected: f.tier === String(t) }, 'Tier ' + t));
    tierSel.value = f.tier;

    const enchSel = el('select', { id: 'f-ench' }, el('option', { value: 'all' }, 'All enchants'));
    for (let e = 0; e <= 4; e++) enchSel.append(el('option', { value: String(e) }, e === 0 ? '.0 (base)' : '.' + e));
    enchSel.value = f.ench;

    const catSel = el('select', { id: 'f-cat' }, el('option', { value: 'all' }, 'All categories'));
    ECON.CATEGORY_GROUPS.forEach(([group, cats]) => {
      const og = el('optgroup', { label: group });
      cats.forEach(([key, label]) => og.append(el('option', { value: key, selected: f.cat === key }, label)));
      catSel.append(og);
    });
    catSel.value = f.cat;

    function syncEnchDisabled() {
      // enchantment only exists from T4 up
      const t = tierSel.value;
      const disabled = t !== 'all' && +t < 4;
      enchSel.disabled = disabled;
      if (disabled) { enchSel.value = 'all'; setFilter('ench', 'all'); }
    }
    syncEnchDisabled();

    tierSel.addEventListener('change', () => { setFilter('tier', tierSel.value); syncEnchDisabled(); scan(); });
    enchSel.addEventListener('change', () => { setFilter('ench', enchSel.value); scan(); });
    catSel.addEventListener('change', () => { setFilter('cat', catSel.value); scan(); });

    const refresh = el('button', { class: 'btn', type: 'button', title: 'Clear the price cache and re-fetch' }, '↻ Refresh prices');
    refresh.addEventListener('click', () => { AODP.clearCache(); scan(); });

    const outlierCb = el('input', { type: 'checkbox' });
    outlierCb.checked = hideOutliers;
    outlierCb.addEventListener('change', () => { hideOutliers = outlierCb.checked; renderResults(); });
    const outlierToggle = el('label', { class: 'switch', title: 'A lone overpriced listing on a quiet market can look like a huge profit. This hides prices far above what the same item sells for in other cities.' },
      outlierCb, el('span', { class: 'switch-track' }), el('span', {}, 'Hide suspicious prices'));

    return el('div', { class: 'filters' },
      el('label', { class: 'filter' }, el('span', {}, 'Tier'), tierSel),
      el('label', { class: 'filter' }, el('span', {}, 'Enchantment'), enchSel),
      el('label', { class: 'filter' }, el('span', {}, 'Category'), catSel),
      el('span', { class: 'spacer' }),
      outlierToggle,
      refresh,
    );
  }

  // ------------------------------------------------------- row selection ----
  // Which (item, enchant level) pairs the current filters ask for.
  function rowSpecs() {
    const f = filters();
    const specs = [];
    const wantTier = f.tier === 'all' ? null : +f.tier;
    const wantEnch = f.ench === 'all' ? null : +f.ench;

    if (f.cat === 'raw') {
      for (const rawUid in D.raw) {
        const r = D.raw[rawUid];
        if (wantTier !== null && r.t !== wantTier) continue;
        if (wantEnch !== null && (r.el || 0) !== wantEnch) continue;
        if (!D.items[r.to]) continue;
        specs.push({ uid: r.to, lvl: D.items[r.to].el || 0, viaRaw: rawUid });
      }
      return specs;
    }

    for (const uid in D.items) {
      const item = D.items[uid];
      if (f.cat !== 'all' && item.c !== f.cat) continue;
      if (wantTier !== null && item.t !== wantTier) continue;
      if (item.el != null || item.c === 'refined') {
        const lvl = item.el || 0;
        if (wantEnch !== null && lvl !== wantEnch) continue;
        specs.push({ uid: uid, lvl: lvl });
      } else {
        for (const lvlStr in item.rx) {
          const lvl = +lvlStr;
          if (wantEnch !== null && lvl !== wantEnch) continue;
          specs.push({ uid: uid, lvl: lvl });
        }
      }
    }
    return specs;
  }

  function specIsCombat(spec) { return !!ECON.BM_CATS[D.items[spec.uid].c]; }

  // ---------------------------------------------------------------- scan ----
  async function scan() {
    if (scanning) { scanQueued = true; return; }
    scanning = true;
    shown = PAGE_SIZE;
    const specs = rowSpecs();

    const status = document.getElementById('scan-status');
    clear(status);
    const barFill = el('div');
    const barText = el('div', { class: 'progress-text' }, 'Preparing…');
    status.append(el('div', { class: 'progress-wrap' }, el('div', { class: 'progress-bar' }, barFill), barText));

    try {
      // finished-goods prices: all royal cities + Black Market when combat gear is in view
      const outIds = [];
      const seen = {};
      let anyCombat = false;
      for (const s of specs) {
        const id = ECON.marketId(s.uid, s.lvl);
        if (!seen[id]) { seen[id] = 1; outIds.push(id); }
        if (specIsCombat(s)) anyCombat = true;
      }
      const cities = ECON.CITIES.slice();
      if (anyCombat) cities.push(ECON.BLACK_MARKET);

      // ingredient prices: selected city only
      const ingIds = {};
      for (const s of specs) collectIngredientIds(s.uid, s.lvl, ingIds);

      const phases = 2;
      const prices = await AODP.prices(STATE.get('server'), outIds, cities, (d, t) => {
        barFill.style.width = (t ? (d / t) * 50 : 50) + '%';
        barText.textContent = 'Fetching market prices… (' + d + '/' + t + ')';
      });
      const ingPrices = await AODP.prices(STATE.get('server'), Object.keys(ingIds), [STATE.get('city')], (d, t) => {
        barFill.style.width = (50 + (t ? (d / t) * 50 : 50)) + '%';
        barText.textContent = 'Fetching material prices… (' + d + '/' + t + ')';
      });
      ingPrices.forEach((v, k) => prices.set(k, v));

      const ctx = ECON.freshCtx(prices);
      results = [];
      noData = 0;
      for (const s of specs) {
        const ev = ECON.evaluate(s.uid, s.lvl, ctx);
        if (!ev) continue;
        ev.viaRaw = s.viaRaw || null;
        if (!ev.hasPrice || !ev.route.ok) { noData++; continue; }
        results.push(ev);
      }
      results.ctx = ctx;
      clear(status);
    } catch (err) {
      clear(status);
      status.append(el('div', { class: 'notice error' },
        'Could not reach the Albion Online Data Project (', String(err.message || err), '). ',
        'Check your connection and try refreshing.'));
      results = [];
    }
    renderResults();
    scanning = false;
    if (scanQueued) { scanQueued = false; scan(); }
  }

  function collectIngredientIds(uid, lvl, into) {
    const item = D.items[uid];
    if (!item) return;
    const rxKey = item.el != null ? '0' : String(lvl);
    const rx = item.rx[rxKey];
    if (rx) for (const ing of rx.in) {
      into[ECON.ingMarketId(ing[0])] = 1;
      // refined mats may be priced by refining from raws — pull those too
      const sub = D.items[ing[0]];
      if (sub && sub.c === 'refined') collectIngredientIds(ing[0], 0, into);
    }
    // upgrade path: base recipe + runes/souls/relics
    if (lvl >= 1 && lvl <= 3 && ECON.upgradeEligible(item, lvl)) {
      collectIngredientIds(uid, 0, into);
      for (let i = 1; i <= lvl; i++) for (const u of item.up[String(i)]) into[ECON.ingMarketId(u[0])] = 1;
    }
  }

  // -------------------------------------------------------------- render ----
  function sortResults() {
    const k = sortKey, dir = sortDir;
    results.sort((a, b) => {
      const av = a[k] === null ? -Infinity : a[k];
      const bv = b[k] === null ? -Infinity : b[k];
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }

  function renderResults() {
    const wrap = document.getElementById('results');
    clear(wrap);

    const f = filters();
    if (f.cat !== 'all' && !ECON.BM_CATS[f.cat]) {
      wrap.append(el('div', { class: 'notice' },
        'ℹ️ The Black Market only buys combat equipment — it doesn’t buy ' +
        (ECON.CAT_LABELS[f.cat] || 'this category').toLowerCase() +
        ', so no Black Market comparison is shown here.'));
    } else if (f.cat !== 'all' && ECON.BM_CATS[f.cat]) {
      wrap.append(el('div', { class: 'notice' },
        '⚔️ Black Market prices are compared automatically for combat equipment — look for the flags in the last column.'));
    }

    const suspects = results.filter(r => r.suspect).length;
    const visibleCount = hideOutliers ? results.length - suspects : results.length;

    if (!visibleCount) {
      if (!scanning) wrap.append(el('div', { class: 'empty-state' },
        el('div', { class: 'leaf', html: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M17.8 3.2C11 3.5 5.6 6.4 4.1 12.1c-.9 3.4.2 6.4.5 7.2.2-2 .8-4.9 2.6-7.5C9 9.2 11.6 7.4 14 6.5c-3.4 2.2-6.4 5.6-7.6 9.5-.6 1.9-.7 3.4-.7 4.3.8.3 2.4.7 4.3.4 5.8-.9 8.9-6.3 8.6-13.2 0-1.6-.3-3.2-.8-4.3Z"/></svg>' }),
        el('p', {}, 'No craftable items with market data match these filters.'),
        noData ? el('p', { class: 'small' }, noData + ' matching item(s) were skipped for missing price data.') : null,
        suspects ? el('p', { class: 'small' }, suspects + ' item(s) hidden as suspicious prices — untick “Hide suspicious prices” to see them.') : null));
      return;
    }

    sortResults();
    const visible = hideOutliers ? results.filter(r => !r.suspect) : results;

    const thSort = (key, label, numeric) => {
      const th = el('th', { class: (numeric ? 'num ' : '') + 'sortable' },
        label + (sortKey === key ? (sortDir < 0 ? ' ▾' : ' ▴') : ''));
      th.addEventListener('click', () => {
        if (sortKey === key) sortDir *= -1; else { sortKey = key; sortDir = -1; }
        renderResults();
      });
      return th;
    };

    const tbody = el('tbody');
    const ctx = results.ctx;
    visible.slice(0, shown).forEach(ev => {
      const item = ev.item;
      const sub = ev.viaRaw
        ? 'refined from ' + (D.raw[ev.viaRaw] ? D.raw[ev.viaRaw].n : ev.viaRaw)
        : (ECON.CAT_LABELS[item.c] || item.c);
      const flags = [];
      if (ev.better) {
        flags.push(el('span', { class: 'flag warn', title: 'Net ' + fmtSilver(ev.better.net) + ' there vs ' + fmtSilver(ev.revenue) + ' here' },
          (ev.better.city === ECON.BLACK_MARKET ? '⚔ Black Market' : ev.better.city) + ' +' + fmtSilver(ev.better.net - ev.revenue)));
      }
      if (ECON.bonusCity(item) === ctx.city) flags.push(el('span', { class: 'flag good', title: 'This city has a specialty bonus for this item' }, '★ bonus'));
      if (ev.suspect) flags.push(el('span', { class: 'flag bad-flag', title: 'This price is far above what the item sells for in other cities — probably a lone overpriced listing, not a real opportunity' }, '⚠ price outlier?'));
      if (hoursAgo(ev.priceAge) > 48) flags.push(el('span', { class: 'stale', title: 'Sell price last observed ' + UTIL.fmtAge(ev.priceAge) }, '⚠ stale'));

      const tr = el('tr', {},
        el('td', { class: 'col-main' }, el('div', { class: 'item-cell' },
          UI.iconImg(ev.id, 36),
          UI.tierChip(ev.tier, ev.lvl),
          el('div', {}, el('div', { class: 'item-name' }, ev.name), el('div', { class: 'item-sub' }, sub)))),
        el('td', { 'data-label': 'Route' }, el('span', { class: 'route-tag' }, ev.route.route === 'direct' ? (ev.lvl ? 'direct .' + ev.lvl : 'craft') : 'upgrade path')),
        el('td', { class: 'num', 'data-label': 'Cost' }, fmtSilver(ev.cost)),
        el('td', { class: 'num', 'data-label': 'Sell' }, fmtSilver(ev.gross)),
        el('td', { class: 'num ' + (ev.profit >= 0 ? 'good' : 'bad'), 'data-label': 'Profit' }, fmtSilver(ev.profit)),
        el('td', { class: 'num', 'data-label': 'Return' }, fmtPct(ev.roi)),
        el('td', { 'data-label': 'Flags' }, flags.length ? flags : el('span', { class: 'muted' }, '—')),
      );
      tr.addEventListener('click', () => UI.openItemModal(ev, ctx));
      tbody.append(tr);
    });

    wrap.append(
      el('div', { class: 'table-wrap' },
        el('table', { class: 'data-table responsive' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Item'),
            el('th', {}, 'Route'),
            thSort('cost', 'Cost', true),
            (function () { const th = thSort('gross', 'Sell', true); th.title = 'Lowest sell order for a single item in your city'; return th; })(),
            thSort('profit', 'Profit', true),
            thSort('roi', 'Return', true),
            el('th', {}, 'Flags'))),
          tbody)),
      el('p', { class: 'muted small', style: 'margin-top:.5rem' },
        'Showing ' + Math.min(shown, visible.length) + ' of ' + visible.length + ' priced crafts' +
        (hideOutliers && suspects ? ' · ' + suspects + ' hidden as suspicious prices' : '') +
        (noData ? ' · ' + noData + ' skipped (no market data)' : '') +
        ' · all prices are per single item · evaluated in ' + ctx.city + (ctx.premium ? ' · Premium' : '') + (ctx.focus ? ' · Focus' : '')),
      shown < visible.length
        ? el('div', { style: 'text-align:center;margin-top:.6rem' },
            el('button', { class: 'btn', type: 'button', onclick: () => { shown += PAGE_SIZE; renderResults(); } },
              'Show ' + Math.min(PAGE_SIZE, visible.length - shown) + ' more'))
        : null,
    );
  }

  // ---------------------------------------------------------------- init ----
  function initPage() {
    root.append(
      el('div', { class: 'page-title' },
        el('h2', {}, 'Best Sellers'),
        el('span', { class: 'sub' }, 'What’s worth crafting and selling right now')),
      el('div', { class: 'panel' },
        buildFilterBar(),
        el('div', { id: 'scan-status' }),
        el('div', { id: 'results' })),
    );
    scan();
  }

  window.PAGE_REFRESH = function () { scan(); };

  document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.page = 'best';
    UI.renderHeader('best');
    UI.renderFooter();
    UI.ensureSetup(initPage);
  });
})();
