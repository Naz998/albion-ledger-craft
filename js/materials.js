// Craft Ledger — My Materials: what's the best thing to craft from what I hold?
'use strict';

(function () {
  const { el, clear, fmtSilver, fmtSilverFull, fmtPct, debounce } = UTIL;
  const D = window.CRAFT_LEDGER_DATA;

  const MAX_ROWS = 15;
  let computing = false;
  let computeQueued = false;

  const root = document.getElementById('app');

  // ---------------------------------------------------------- pickables ----
  // Materials the user can say they own: raw/refined resources, herbs, crops,
  // animal products, fish products, runes/souls/relics, grown animals.
  const PICKABLES = (function () {
    const list = [];
    for (const uid in D.ingredients) {
      const ing = D.ingredients[uid];
      list.push({ id: uid, name: ing.n, tier: ing.t, kind: ing.k, el: enchOf(uid) });
    }
    for (const uid in D.items) {
      const it = D.items[uid];
      if (it.c === 'refined') list.push({ id: uid, name: it.n, tier: it.t, kind: 'refined', el: it.el || 0 });
    }
    list.sort((a, b) => a.name.localeCompare(b.name) || (a.tier || 0) - (b.tier || 0));
    return list;
  })();

  function enchOf(uid) {
    const m = /_LEVEL(\d)$/.exec(uid);
    return m ? +m[1] : 0;
  }
  function nameOf(uid) { return ECON.ingName(uid); }
  function tierOf(uid) {
    if (D.items[uid]) return D.items[uid].t;
    if (D.ingredients[uid]) return D.ingredients[uid].t;
    return null;
  }

  // ------------------------------------------------------------- picker ----
  function buildPicker() {
    const input = el('input', { type: 'search', placeholder: 'Search materials… (e.g. “pine planks”, “rune”)', 'aria-label': 'Search materials' });
    const qty = el('input', { type: 'number', min: '1', value: '100', style: 'width:90px', 'aria-label': 'Quantity' });
    const dropdown = el('div', { class: 'picker-results', hidden: true });

    function search() {
      const q = input.value.trim().toLowerCase();
      clear(dropdown);
      if (q.length < 2) { dropdown.hidden = true; return; }
      const terms = q.split(/\s+/);
      const hits = PICKABLES.filter(p => {
        const hay = (p.name + ' t' + p.tier + ' .' + p.el).toLowerCase();
        return terms.every(t => hay.indexOf(t) >= 0);
      }).slice(0, 12);
      if (!hits.length) { dropdown.hidden = true; return; }
      hits.forEach(p => {
        const b = el('button', { type: 'button' },
          UI.tierChip(p.tier || '?', p.el),
          el('span', {}, p.name),
          el('span', { class: 'muted small', style: 'margin-left:auto' }, p.kind));
        b.addEventListener('click', () => {
          STATE.addMaterial(p.id, Math.max(1, +qty.value || 1));
          input.value = '';
          dropdown.hidden = true;
          renderInventory();
          recompute();
        });
        dropdown.append(b);
      });
      dropdown.hidden = false;
    }
    input.addEventListener('input', debounce(search, 120));
    input.addEventListener('focus', search);
    document.addEventListener('click', ev => {
      if (!dropdown.hidden && !dropdown.contains(ev.target) && ev.target !== input) dropdown.hidden = true;
    });

    return el('div', {},
      el('div', { style: 'display:flex;gap:.5rem' },
        el('div', { class: 'picker', style: 'flex:1' }, input, dropdown), qty),
    );
  }

  function renderInventory() {
    const listEl = document.getElementById('inv-list');
    clear(listEl);
    const mats = STATE.get('materials');
    if (!mats.length) {
      listEl.append(el('li', { class: 'muted', style: 'border:none;background:none' },
        'Nothing yet — add the raw or refined materials you’re holding.'));
      return;
    }
    mats.forEach(m => {
      const qtyInput = el('input', { type: 'number', min: '0', value: String(m.qty), 'aria-label': 'Quantity of ' + nameOf(m.id) });
      qtyInput.addEventListener('change', () => {
        STATE.setMaterialQty(m.id, Math.max(0, +qtyInput.value || 0));
        renderInventory();
        recompute();
      });
      listEl.append(el('li', {},
        UI.tierChip(tierOf(m.id) || '?', enchOf(m.id)),
        el('span', { class: 'name' }, nameOf(m.id)),
        qtyInput,
        el('button', { class: 'remove', type: 'button', title: 'Remove', onclick: () => { STATE.removeMaterial(m.id); renderInventory(); recompute(); } }, '✕'),
      ));
    });
  }

  // --------------------------------------------------------- candidates ----
  function ownedMap() {
    const map = {};
    STATE.get('materials').forEach(m => { if (m.qty > 0) map[m.id] = m.qty; });
    return map;
  }

  // Candidate craft routes touching at least one owned material.
  function candidates(owned) {
    const out = [];
    const ownsFragment = Object.keys(owned).some(id => /_(RUNE|SOUL|RELIC)$/.test(id));

    for (const uid in D.items) {
      const item = D.items[uid];
      if (item.el != null || item.c === 'refined') {
        pushIf(uid, item, item.el || 0, 'direct');
        continue;
      }
      for (const lvlStr in item.rx) pushIf(uid, item, +lvlStr, 'direct');
      if (ownsFragment && item.up) {
        for (let l = 1; l <= 3; l++) {
          if (ECON.upgradeEligible(item, l)) pushIf(uid, item, l, 'upgrade');
        }
      }
    }

    function pushIf(uid, item, lvl, route) {
      const ings = routeIngredients(item, uid, lvl, route);
      if (!ings) return;
      for (const ing of ings) {
        if (owned[ing[0]]) { out.push({ uid, lvl, route }); return; }
      }
    }
    return out;
  }

  function routeIngredients(item, uid, lvl, route) {
    if (route === 'direct') {
      const rx = item.rx[item.el != null ? '0' : String(lvl)];
      return rx ? rx.in : null;
    }
    const rx = item.rx['0'];
    if (!rx || !ECON.upgradeEligible(item, lvl)) return null;
    const ings = rx.in.slice();
    for (let i = 1; i <= lvl; i++) for (const u of item.up[String(i)]) ings.push([u[0], u[1], 1]);
    return ings;
  }

  // ------------------------------------------------------------ compute ----
  async function recompute() {
    if (computing) { computeQueued = true; return; }
    computing = true;
    const resultsEl = document.getElementById('mat-results');
    const owned = ownedMap();

    if (!Object.keys(owned).length) {
      clear(resultsEl);
      resultsEl.append(el('div', { class: 'empty-state' },
        el('p', {}, 'Add materials on the left and Craft Ledger will work out the most profitable things to make with them — plus a shopping list when you’re a few ingredients short.')));
      computing = false;
      return;
    }

    clear(resultsEl);
    const barFill = el('div');
    resultsEl.append(el('div', { class: 'progress-wrap' },
      el('div', { class: 'progress-bar' }, barFill),
      el('div', { class: 'progress-text' }, 'Checking current prices…')));

    try {
      const cands = candidates(owned);
      const ids = {};
      for (const id in owned) ids[ECON.ingMarketId(id)] = 1;
      for (const c of cands) {
        const item = D.items[c.uid];
        ids[ECON.marketId(c.uid, c.lvl)] = 1;
        for (const ing of routeIngredients(item, c.uid, c.lvl, c.route)) ids[ECON.ingMarketId(ing[0])] = 1;
      }
      const prices = await AODP.prices(STATE.get('server'), Object.keys(ids), [STATE.get('city')],
        (d, t) => { barFill.style.width = (t ? d / t * 100 : 100) + '%'; });
      const ctx = ECON.freshCtx(prices);

      const rows = [];
      for (const c of cands) {
        const r = evaluateCandidate(c, owned, ctx);
        if (r) rows.push(r);
      }
      // keep the better route per (item, level)
      const bestByKey = {};
      for (const r of rows) {
        const k = r.uid + '@' + r.lvl;
        if (!bestByKey[k] || r.cashProfit > bestByKey[k].cashProfit) bestByKey[k] = r;
      }
      const deduped = Object.values(bestByKey);
      renderCraftResults(deduped, ctx);
    } catch (err) {
      clear(resultsEl);
      resultsEl.append(el('div', { class: 'notice error' },
        'Could not fetch prices (', String(err.message || err), '). Try again in a moment.'));
    }
    computing = false;
    if (computeQueued) { computeQueued = false; recompute(); }
  }

  function evaluateCandidate(c, owned, ctx) {
    const item = D.items[c.uid];
    const ings = routeIngredients(item, c.uid, c.lvl, c.route);
    if (!ings) return null;
    const rr = ECON.returnRate(item, ctx).rate;
    const rxKey = item.el != null ? '0' : String(c.lvl);
    const batch = c.route === 'direct' ? (item.rx[rxKey].b || 1) : 1;

    // effective per-batch needs, then how many batches the owned stock supports
    const needs = ings.map(ing => ({
      id: ing[0],
      name: nameOf(ing[0]),
      eff: ing[2] || c.route === 'upgrade' && /_(RUNE|SOUL|RELIC)$/.test(ing[0]) ? ing[1] : ing[1] * (1 - rr),
      owned: owned[ing[0]] || 0,
    }));

    let ownedLimit = Infinity;
    let touchesOwned = false;
    for (const n of needs) {
      if (n.owned > 0) { touchesOwned = true; ownedLimit = Math.min(ownedLimit, Math.floor(n.owned / n.eff)); }
    }
    if (!touchesOwned) return null;
    const batches = Math.max(1, ownedLimit === Infinity ? 1 : ownedLimit);

    const gross = (function () {
      const row = ctx.prices.get(ECON.marketId(c.uid, c.lvl) + '|' + ctx.city);
      return row && row.sell_price_min > 0 ? row.sell_price_min : 0;
    })();
    if (!gross) return null;

    let shoppingCost = 0, usedValue = 0, unpriceable = false;
    const shopping = [], consumed = [];
    for (const n of needs) {
      const totalNeed = n.eff * batches;
      const fromStock = Math.min(n.owned, totalNeed);
      const short = totalNeed - fromStock;
      const unit = (function () {
        const row = ctx.prices.get(ECON.ingMarketId(n.id) + '|' + ctx.city);
        return row && row.sell_price_min > 0 ? row.sell_price_min : 0;
      })();
      if (fromStock > 0) {
        consumed.push({ name: n.name, qty: fromStock, unit });
        usedValue += fromStock * unit;
      }
      if (short > 0.001) {
        if (!unit) unpriceable = true;
        shopping.push({ name: n.name, qty: Math.ceil(short), unit, cost: Math.ceil(short) * unit });
        shoppingCost += Math.ceil(short) * unit;
      }
    }

    const revenue = ECON.netSell(ctx, gross) * batch * batches;
    return {
      uid: c.uid, lvl: c.lvl, route: c.route, item, name: item.n, tier: item.t,
      unitsOut: batch * batches, batches, gross,
      revenue, shopping, shoppingCost, consumed, usedValue,
      cashProfit: revenue - shoppingCost,
      econProfit: revenue - shoppingCost - usedValue,
      readyNow: shopping.length === 0,
      unpriceable,
    };
  }

  // -------------------------------------------------------------- render ----
  function renderCraftResults(rows, ctx) {
    const resultsEl = document.getElementById('mat-results');
    clear(resultsEl);

    const usable = rows.filter(r => !r.unpriceable && r.econProfit !== null);
    const ready = usable.filter(r => r.readyNow).sort((a, b) => b.econProfit - a.econProfit);
    const shop = usable.filter(r => !r.readyNow).sort((a, b) => b.econProfit - a.econProfit);

    if (!usable.length) {
      resultsEl.append(el('div', { class: 'empty-state' },
        el('p', {}, 'No crafts found that use these materials (or the markets are missing price data right now).')));
      return;
    }

    if (ready.length) {
      resultsEl.append(el('h3', {}, '✓ Ready to craft — you have everything'));
      resultsEl.append(craftTable(ready.slice(0, MAX_ROWS), ctx, false));
    }
    if (shop.length) {
      resultsEl.append(el('h3', {}, '🧺 Worth a shopping trip — you’re a few ingredients short'));
      resultsEl.append(craftTable(shop.slice(0, MAX_ROWS), ctx, true));
    }
    resultsEl.append(el('p', { class: 'muted tiny', style: 'margin-top:.7rem' },
      'Profit = net sale in ' + ctx.city + ' (after 2.5% setup + ' + fmtPct(ECON.salesTax(ctx), 0) +
      ' tax) minus what you’d still need to buy, minus the market value of your own materials consumed. ' +
      'Resource return is applied at your current city/Focus settings.'));
  }

  function craftTable(rows, ctx, withShopping) {
    const tbody = el('tbody');
    rows.forEach(r => {
      const detail = el('tr', { class: 'static', hidden: true },
        el('td', { colspan: '6', style: 'background:rgba(0,0,0,.18)' }, detailBlock(r)));
      const tr = el('tr', {},
        el('td', { class: 'col-main' }, el('div', { class: 'item-cell' },
          UI.tierChip(r.tier, r.lvl),
          el('div', {},
            el('div', { class: 'item-name' }, r.name),
            el('div', { class: 'item-sub' },
              r.unitsOut + '× · ' + (r.route === 'upgrade' ? 'upgrade path' : 'direct craft'))))),
        el('td', { class: 'num', 'data-label': 'Revenue' }, fmtSilver(r.revenue)),
        el('td', { class: 'num', 'data-label': 'To buy' }, withShopping ? fmtSilver(r.shoppingCost) : '—'),
        el('td', { class: 'num', 'data-label': 'Mats value' }, fmtSilver(r.usedValue)),
        el('td', { class: 'num ' + (r.econProfit >= 0 ? 'good' : 'bad'), 'data-label': 'Profit' }, fmtSilver(r.econProfit)),
        el('td', { class: 'num', 'data-label': 'Cash out' }, el('span', { class: r.cashProfit >= 0 ? 'good' : 'bad' }, fmtSilver(r.cashProfit))),
      );
      tr.addEventListener('click', () => { detail.hidden = !detail.hidden; });
      tbody.append(tr, detail);
    });
    return el('div', { class: 'table-wrap', style: 'margin-bottom:1rem' },
      el('table', { class: 'data-table responsive' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Craft'),
          el('th', { class: 'num' }, 'Revenue'),
          el('th', { class: 'num' }, 'To buy'),
          el('th', { class: 'num' }, 'Mats value'),
          el('th', { class: 'num', title: 'Revenue − shopping − market value of your materials' }, 'Profit'),
          el('th', { class: 'num', title: 'Revenue − shopping (your materials treated as free)' }, 'Cash out'))),
        tbody));
  }

  function detailBlock(r) {
    const wrap = el('div', { style: 'padding:.4rem .2rem' });
    wrap.append(el('div', { class: 'small muted' },
      'Crafts ' + r.unitsOut + ' item(s) in ' + r.batches + ' batch(es) · sells at ' + fmtSilverFull(r.gross) + ' each before fees.'));
    if (r.consumed.length) {
      wrap.append(el('div', { class: 'small', style: 'margin-top:.4rem' }, el('strong', {}, 'Uses from your stock: '),
        r.consumed.map(cst => cst.qty.toFixed(0) + '× ' + cst.name).join(', ')));
    }
    if (r.shopping.length) {
      const ul = el('ul', { class: 'missing-list' });
      r.shopping.forEach(s => ul.append(el('li', {},
        s.qty + '× ' + s.name + ' — ',
        s.unit ? el('span', {}, fmtSilverFull(s.cost) + ' (' + fmtSilver(s.unit) + ' ea)') : el('span', { class: 'bad' }, 'no price data'))));
      wrap.append(el('div', { class: 'small', style: 'margin-top:.4rem' },
        el('strong', {}, 'Shopping list (' + fmtSilver(r.shoppingCost) + '): '), ul));
    }
    const openBtn = el('button', { class: 'btn small', type: 'button', style: 'margin-top:.5rem' }, 'Open full breakdown & price chart');
    openBtn.addEventListener('click', async ev => {
      ev.stopPropagation();
      // full evaluation for the modal (prices for this route are already cached)
      const ids = { };
      ids[ECON.marketId(r.uid, r.lvl)] = 1;
      const item = D.items[r.uid];
      for (const ing of routeIngredients(item, r.uid, r.lvl, r.route) || []) ids[ECON.ingMarketId(ing[0])] = 1;
      const prices = await AODP.prices(STATE.get('server'), Object.keys(ids), [STATE.get('city')]);
      const ctx = ECON.freshCtx(prices);
      const evaluated = ECON.evaluate(r.uid, r.lvl, ctx);
      if (evaluated) UI.openItemModal(evaluated, ctx);
    });
    wrap.append(openBtn);
    return wrap;
  }

  // ---------------------------------------------------------------- init ----
  function initPage() {
    root.append(
      el('div', { class: 'page-title' },
        el('h2', {}, 'My Materials'),
        el('span', { class: 'sub' }, 'The best crafts from what you’re holding')),
      el('div', { class: 'two-col' },
        el('div', { class: 'panel' },
          el('h3', { style: 'margin-top:0' }, 'Your materials'),
          buildPicker(),
          el('ul', { class: 'inv-list', id: 'inv-list' })),
        el('div', { class: 'panel' },
          el('div', { id: 'mat-results' }))),
    );
    renderInventory();
    recompute();
  }

  window.PAGE_REFRESH = function () { recompute(); };

  document.addEventListener('DOMContentLoaded', () => {
    document.body.dataset.page = 'materials';
    UI.renderHeader('materials');
    UI.renderFooter();
    UI.ensureSetup(initPage);
  });
})();
