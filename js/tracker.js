// Craft Ledger — Tracker: plan a crafting run. For each tracked item+quantity,
// shows what to gather (raw), what to buy instead (refined), and the total
// cost/profit of the run at current prices.
'use strict';

(function () {
  const { el, clear, fmtSilver, fmtSilverFull, fmtPct } = UTIL;
  const D = window.CRAFT_LEDGER_DATA;

  const root = document.getElementById('app');
  let computing = false;
  let computeQueued = false;

  // ---- ids needed to price a tracked craft (route mats + full raw chain) ----
  function collectIds(uid, lvl, into) {
    const item = D.items[uid];
    if (!item) return;
    into[ECON.marketId(uid, item.el != null ? item.el : lvl)] = 1;
    const rxKey = item.el != null ? '0' : String(lvl);
    const rx = item.rx[rxKey];
    if (rx) for (const ing of rx.in) {
      into[ECON.ingMarketId(ing[0])] = 1;
      const sub = D.items[ing[0]];
      if (sub && sub.c === 'refined') collectIds(ing[0], 0, into);
    }
    if (lvl >= 1 && lvl <= 3 && ECON.upgradeEligible(item, lvl)) {
      collectIds(uid, 0, into);
      for (let i = 1; i <= lvl; i++) for (const u of item.up[String(i)]) into[ECON.ingMarketId(u[0])] = 1;
    }
  }

  // ---- decompose a material into gatherable/base components ----
  function expandRaw(uid, qty, acc, ctx) {
    const it = D.items[uid];
    if (it && it.c === 'refined' && it.rx['0']) {
      const rr = ECON.returnRate(it, ctx).rate;
      const rx = it.rx['0'];
      for (const ing of rx.in) {
        const eff = (ing[2] ? ing[1] : ing[1] * (1 - rr)) / (rx.b || 1);
        expandRaw(ing[0], qty * eff, acc, ctx);
      }
    } else {
      acc[uid] = (acc[uid] || 0) + qty;
    }
  }

  function unitPrice(ctx, uid) {
    const row = ctx.prices.get(ECON.ingMarketId(uid) + '|' + ctx.city);
    return row && row.sell_price_min > 0 ? row.sell_price_min : 0;
  }

  // ---- build the plan for one tracked entry ----
  function planFor(t, ctx) {
    const item = D.items[t.uid];
    if (!item) return null;
    const ev = ECON.evaluate(t.uid, t.lvl, ctx);
    if (!ev) return null;
    const route = ev.route;
    const batches = Math.ceil(t.qty / route.batch);
    const outQty = batches * route.batch;

    // shopping list at the refined/ingredient level (per-batch eff × batches)
    const buy = route.rows.map(r => {
      const need = Math.ceil(r.eff * batches);
      const unit = unitPrice(ctx, r.id);
      return { id: r.id, name: r.name, need: need, unit: unit, cost: need * unit, upgradeStep: r.upgradeStep };
    });
    const buyTotal = buy.reduce((s, b) => s + b.cost, 0);

    // gather list: everything decomposed down to raw resources
    const rawAcc = {};
    for (const r of route.rows) expandRaw(r.id, r.eff * batches, rawAcc, ctx);
    const raw = Object.keys(rawAcc).map(uid => {
      const need = Math.ceil(rawAcc[uid]);
      const unit = unitPrice(ctx, uid);
      return { id: uid, name: ECON.ingName(uid), need: need, unit: unit, cost: need * unit };
    }).sort((a, b) => b.cost - a.cost);
    const rawTotal = raw.reduce((s, b) => s + b.cost, 0);

    return { t, item, ev, route, batches, outQty, buy, buyTotal, raw, rawTotal };
  }

  // ---- compute + render ----
  async function recompute() {
    if (computing) { computeQueued = true; return; }
    computing = true;
    const listEl = document.getElementById('tracked-list');
    const tracked = STATE.get('tracked') || [];

    if (!tracked.length) {
      clear(listEl);
      listEl.append(el('div', { class: 'empty-state' },
        el('p', {}, 'Nothing tracked yet.'),
        el('p', { class: 'small' }, 'Open any item on ', el('a', { href: 'index.html' }, 'Best Sellers'),
          ', set a quantity, and press “+ Track this craft”. Your material plan will appear here.')));
      computing = false;
      return;
    }

    clear(listEl);
    const barFill = el('div');
    listEl.append(el('div', { class: 'progress-wrap' },
      el('div', { class: 'progress-bar' }, barFill),
      el('div', { class: 'progress-text' }, 'Pricing your crafting runs…')));

    try {
      const ids = {};
      const outIds = {};
      for (const t of tracked) {
        collectIds(t.uid, t.lvl, ids);
        const item = D.items[t.uid];
        if (item) outIds[ECON.marketId(t.uid, item.el != null ? item.el : t.lvl)] = 1;
      }
      // outputs across all cities so the price-outlier warning can fire
      const prices = await AODP.prices(STATE.get('server'), Object.keys(outIds), ECON.CITIES,
        (d, tot) => { barFill.style.width = (tot ? d / tot * 40 : 40) + '%'; });
      const ingPrices = await AODP.prices(STATE.get('server'), Object.keys(ids), [STATE.get('city')],
        (d, tot) => { barFill.style.width = (40 + (tot ? d / tot * 60 : 60)) + '%'; });
      ingPrices.forEach((v, k) => prices.set(k, v));
      const ctx = ECON.freshCtx(prices);

      clear(listEl);
      let any = false;
      for (const t of tracked) {
        const plan = planFor(t, ctx);
        if (plan) { listEl.append(renderCard(plan, ctx)); any = true; }
      }
      if (!any) listEl.append(el('div', { class: 'empty-state' }, el('p', {}, 'Could not price the tracked crafts right now.')));
      else listEl.append(el('p', { class: 'muted tiny' },
        'Material amounts already include the resource return at your current city/Focus settings, rounded up. ' +
        'Actual use varies a little with return luck. Prices are the lowest sell orders in ' + ctx.city + ' right now.'));
    } catch (err) {
      clear(listEl);
      listEl.append(el('div', { class: 'notice error' }, 'Could not fetch prices (', String(err.message || err), '). Try again in a moment.'));
    }
    computing = false;
    if (computeQueued) { computeQueued = false; recompute(); }
  }

  function matTable(title, rows, total, emptyNote) {
    const tbody = el('tbody');
    rows.forEach(r => tbody.append(el('tr', { class: 'static' },
      el('td', {}, el('div', { class: 'item-cell', style: 'min-width:0' },
        UI.iconImg(ECON.ingMarketId(r.id), 26), el('span', {}, r.name),
        r.upgradeStep ? el('span', { class: 'muted small' }, '(upgrade .' + r.upgradeStep + ')') : null)),
      el('td', { class: 'num' }, r.need.toLocaleString('en-US')),
      el('td', { class: 'num' }, r.unit ? fmtSilver(r.unit) : el('span', { class: 'bad' }, '—')),
      el('td', { class: 'num' }, r.unit ? fmtSilver(r.cost) : el('span', { class: 'bad' }, 'no data')),
    )));
    tbody.append(el('tr', { class: 'static total-row' },
      el('td', {}, 'Total'), el('td', {}), el('td', {}),
      el('td', { class: 'num' }, fmtSilver(total))));
    return el('div', {},
      el('h3', { style: 'margin-top:.4rem' }, title),
      emptyNote ? el('p', { class: 'muted small' }, emptyNote) : null,
      el('div', { class: 'table-wrap' },
        el('table', { class: 'data-table' },
          el('thead', {}, el('tr', {},
            el('th', {}, 'Material'), el('th', { class: 'num' }, 'Amount'),
            el('th', { class: 'num' }, 'Unit'), el('th', { class: 'num' }, 'Value'))),
          tbody)));
  }

  function renderCard(plan, ctx) {
    const t = plan.t, ev = plan.ev;
    const qtyIn = el('input', { type: 'number', min: '1', value: String(t.qty), style: 'width:90px', 'aria-label': 'Quantity to craft' });
    qtyIn.addEventListener('change', () => {
      STATE.setTrackedQty(t.uid, t.lvl, Math.max(1, Math.floor(+qtyIn.value || 1)));
      recompute();
    });
    const removeBtn = el('button', { class: 'btn small', type: 'button' }, '✕ Remove');
    removeBtn.addEventListener('click', () => {
      STATE.removeTracked(t.uid, t.lvl);
      UI.updateTrackerBadge();
      recompute();
    });

    const totalCost = ev.cost * plan.outQty;
    const totalRevenue = ev.revenue * plan.outQty;
    const totalProfit = ev.profit * plan.outQty;
    const routeLabel = plan.route.route === 'direct'
      ? (t.lvl ? 'crafted directly from .' + t.lvl + ' materials' : 'direct craft')
      : 'base craft + rune/soul/relic upgrade to .' + t.lvl;

    return el('div', { class: 'panel tracker-card' },
      el('div', { class: 'tracker-head' },
        UI.iconImg(ev.id, 44),
        UI.tierChip(ev.tier, ev.lvl),
        el('div', { class: 'tracker-title' },
          el('div', { class: 'item-name', style: 'font-size:1.05rem' }, ev.name),
          el('div', { class: 'item-sub' }, routeLabel +
            (plan.outQty !== t.qty ? ' · crafts in batches of ' + plan.route.batch + ', so you’ll make ' + plan.outQty : ''))),
        el('label', { class: 'muted small', style: 'margin-left:auto;display:flex;align-items:center;gap:.4rem' }, 'Quantity', qtyIn),
        removeBtn),
      el('div', { class: 'profit-summary' },
        UI.stat('Craft cost', fmtSilver(totalCost), 'for ' + plan.outQty + ' item(s)'),
        UI.stat('Sell revenue', fmtSilver(totalRevenue), 'net after fees, ' + ctx.city),
        UI.stat('Profit', fmtSilver(totalProfit), fmtPct(ev.roi, 1) + ' return', totalProfit >= 0 ? 'good' : 'bad'),
        UI.stat('Per item', fmtSilver(ev.profit), 'sell ' + fmtSilverFull(ev.gross) + ' each')),
      ev.suspect ? el('p', { class: 'flag warn' }, '⚠ The sell price here looks far above other cities — double-check before committing.') : null,
      el('div', { class: 'list-grid' },
        matTable('🧺 Buy refined / ingredients', plan.buy, plan.buyTotal,
          'If you’d rather just buy everything at the ' + ctx.city + ' market.'),
        matTable('⛏ Gather raw', plan.raw, plan.rawTotal,
          'Everything broken down to gatherable resources (market value shown for comparison). Runes, crops and other non-gatherables stay as-is.')),
    );
  }

  // ---------------------------------------------------------------- init ----
  function initPage() {
    root.append(
      el('div', { class: 'page-title' },
        el('h2', {}, 'Crafting Tracker'),
        el('span', { class: 'sub' }, 'Your planned crafting runs and material lists')),
      el('div', { id: 'tracked-list' }),
    );
    recompute();
  }

  window.PAGE_REFRESH = function () { recompute(); };

  document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.page = 'tracker';
    UI.renderHeader('tracker');
    UI.renderFooter();
    UI.ensureSetup(initPage);
  });
})();
