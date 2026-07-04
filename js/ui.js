// Craft Ledger — shared chrome: header, settings bar, first-run setup, item modal.
'use strict';

window.UI = (function () {
  const { el, clear, fmtSilver, fmtSilverFull, fmtPct, fmtAge } = UTIL;

  const LEAF_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M17.8 3.2C11 3.5 5.6 6.4 4.1 12.1c-.9 3.4.2 6.4.5 7.2.2-2 .8-4.9 2.6-7.5C9 9.2 11.6 7.4 14 6.5c-3.4 2.2-6.4 5.6-7.6 9.5-.6 1.9-.7 3.4-.7 4.3.8.3 2.4.7 4.3.4 5.8-.9 8.9-6.3 8.6-13.2 0-1.6-.3-3.2-.8-4.3Z"/></svg>';

  // Official Albion item renders (works for enchanted ids like T4_MAIN_SWORD@2)
  function iconUrl(marketId, size) {
    return 'https://render.albiononline.com/v1/item/' + encodeURIComponent(marketId) + '.png?size=' + (size || 64);
  }
  function iconImg(marketId, size) {
    const img = el('img', {
      class: 'item-icon', src: iconUrl(marketId, Math.min(217, (size || 36) * 2)),
      width: size || 36, height: size || 36, loading: 'lazy', alt: '',
    });
    img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
    return img;
  }

  // ------------------------------------------------------------ header ----
  function renderHeader(active) {
    const header = el('header', { class: 'site-header' },
      el('div', { class: 'header-inner' },
        el('a', { class: 'brand', href: 'index.html' },
          el('span', { class: 'brand-leaf', html: LEAF_SVG }),
          el('span', { class: 'brand-name' }, 'Craft Ledger'),
        ),
        el('nav', { class: 'main-nav' },
          el('a', { href: 'index.html', class: active === 'best' ? 'active' : null }, 'Best Sellers'),
          el('a', { href: 'materials.html', class: active === 'materials' ? 'active' : null }, 'My Materials'),
          el('a', { href: 'tracker.html', class: active === 'tracker' ? 'active' : null }, 'Tracker',
            el('span', { class: 'nav-badge', id: 'tracker-badge' })),
        ),
      ),
      renderSettingsBar(),
    );
    document.body.prepend(header);
    updateTrackerBadge();
  }

  function renderSettingsBar() {
    const serverSel = el('select', { id: 'set-server', 'aria-label': 'Server' });
    for (const key in AODP.SERVER_LABELS) {
      serverSel.append(el('option', { value: key, selected: STATE.get('server') === key }, AODP.SERVER_LABELS[key]));
    }
    serverSel.addEventListener('change', () => {
      STATE.set('server', serverSel.value);
      AODP.clearCache();
      notify('server');
    });

    const citySel = el('select', { id: 'set-city', 'aria-label': 'City' });
    ECON.CITIES.forEach(c => citySel.append(el('option', { value: c, selected: STATE.get('city') === c }, c)));
    citySel.addEventListener('change', () => { STATE.set('city', citySel.value); notify('city'); });

    function toggle(key, label, hint) {
      const input = el('input', { type: 'checkbox', role: 'switch' });
      input.checked = !!STATE.get(key);
      input.addEventListener('change', () => { STATE.set(key, input.checked); notify(key); });
      return el('label', { class: 'switch', title: hint }, input, el('span', { class: 'switch-track' }), el('span', {}, label));
    }

    return el('div', { class: 'settings-bar' },
      el('span', { class: 'settings-label' }, 'Market:'),
      serverSel, citySel,
      toggle('premium', 'Premium', 'Premium account: 4% sales tax instead of 8%'),
      toggle('focus', 'Focus', 'Spend crafting focus: +59% resource return'),
      el('span', { class: 'city-bonus-hint', id: 'city-bonus-hint' }, cityBonusHint()),
    );
  }

  function cityBonusHint() {
    const city = STATE.get('city');
    if (!city) return '';
    const refine = Object.keys(ECON.REFINE_CITY).find(k => ECON.REFINE_CITY[k] === city);
    const crafts = { 'Fort Sterling': 'hammers, spears, holy staffs, plate helmets, cloth chests', Lymhurst: 'swords, bows, arcane staffs, leather helmets & shoes', Martlock: 'axes, quarterstaffs, frost staffs, plate boots, off-hands', Bridgewatch: 'crossbows, daggers, cursed staffs, plate chests, cloth shoes', Thetford: 'maces, fire & nature staffs, leather chests, cloth helmets', Caerleon: 'food, gathering gear & tools, war gloves, shapeshifter staffs', Brecilien: 'capes, bags, potions' };
    const parts = [];
    if (refine) parts.push('+40% refining ' + refine);
    if (crafts[city]) parts.push('+15% crafting ' + crafts[city]);
    return parts.join(' · ');
  }

  function notify(what) {
    const hint = document.getElementById('city-bonus-hint');
    if (hint) hint.textContent = cityBonusHint();
    if (typeof window.PAGE_REFRESH === 'function') window.PAGE_REFRESH(what);
  }

  function updateTrackerBadge() {
    const badge = document.getElementById('tracker-badge');
    if (!badge) return;
    const n = (STATE.get('tracked') || []).length;
    badge.textContent = n ? String(n) : '';
    badge.style.display = n ? '' : 'none';
  }

  // ----------------------------------------------------- first-run setup ----
  function ensureSetup(onReady) {
    if (STATE.isSetup()) { onReady(); return; }
    let server = STATE.get('server'), city = STATE.get('city');

    const serverRow = el('div', { class: 'choice-row' });
    for (const key in AODP.SERVER_LABELS) {
      const b = el('button', { class: 'choice', type: 'button' }, AODP.SERVER_LABELS[key]);
      b.addEventListener('click', () => {
        server = key;
        serverRow.querySelectorAll('.choice').forEach(x => x.classList.remove('picked'));
        b.classList.add('picked');
        update();
      });
      serverRow.append(b);
    }
    const cityRow = el('div', { class: 'choice-row wrap' });
    ECON.CITIES.forEach(c => {
      const b = el('button', { class: 'choice', type: 'button' }, c);
      b.addEventListener('click', () => {
        city = c;
        cityRow.querySelectorAll('.choice').forEach(x => x.classList.remove('picked'));
        b.classList.add('picked');
        update();
      });
      cityRow.append(b);
    });

    const go = el('button', { class: 'btn primary', type: 'button', disabled: true }, 'Enter the market');
    function update() { if (server && city) go.removeAttribute('disabled'); }
    go.addEventListener('click', () => {
      STATE.set('server', server);
      STATE.set('city', city);
      overlay.remove();
      // rebuild header so selects reflect the choice
      document.querySelector('.site-header').remove();
      renderHeader(document.body.dataset.page);
      onReady();
    });

    const overlay = el('div', { class: 'modal-overlay setup' },
      el('div', { class: 'modal setup-modal' },
        el('div', { class: 'setup-art', html: LEAF_SVG }),
        el('h2', {}, 'Welcome to Craft Ledger'),
        el('p', { class: 'muted' }, 'Live crafting profits for Albion Online. Pick your server and home market to begin — you can change these any time from the bar above.'),
        el('h3', {}, 'Server'), serverRow,
        el('h3', {}, 'City'), cityRow,
        el('div', { class: 'modal-actions' }, go),
      ),
    );
    document.body.append(overlay);
  }

  // ------------------------------------------------------------- modal ----
  function openModal(content, cls) {
    const overlay = el('div', { class: 'modal-overlay' },
      el('div', { class: 'modal ' + (cls || '') },
        el('button', { class: 'modal-close', type: 'button', 'aria-label': 'Close', onclick: () => overlay.remove() }, '✕'),
        content,
      ),
    );
    overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });
    document.body.append(overlay);
    return overlay;
  }

  function enchChip(lvl) {
    return el('span', { class: 'ench ench-' + lvl }, '.' + lvl);
  }
  function tierChip(tier, lvl) {
    return el('span', { class: 'tier-chip' }, 'T' + tier, lvl ? enchChip(lvl) : null);
  }

  // Item detail: cost breakdown + route comparison + history chart
  function openItemModal(ev, ctx) {
    const item = ev.item;
    const cityNote = ECON.bonusCity(item) === ctx.city
      ? el('span', { class: 'flag good' }, (item.c === 'refined' ? '+40% refining' : '+15% crafting') + ' bonus in ' + ctx.city)
      : null;

    const rr = ev.route.rr;
    const rows = ev.route.rows.map(r =>
      el('tr', {},
        el('td', {}, r.name, r.upgradeStep ? el('span', { class: 'muted small' }, ' (upgrade .' + r.upgradeStep + ')') : null),
        el('td', { class: 'num' }, String(r.qty)),
        el('td', { class: 'num', title: r.noReturn ? 'No resource return on this ingredient' : 'After ' + fmtPct(rr.rate, 0) + ' resource return' }, r.eff.toFixed(1)),
        el('td', { class: 'num' }, r.unit > 0 ? fmtSilverFull(r.unit) : el('span', { class: 'bad' }, 'no data'),
          r.src === 'craft' ? el('span', { class: 'muted small' }, ' (refine)') : null),
        el('td', { class: 'num' }, fmtSilverFull(r.total)),
      ));

    const routeLabel = ev.route.route === 'direct'
      ? (ev.lvl ? 'Crafted directly from .' + ev.lvl + ' materials' : 'Crafted from base materials')
      : 'Crafted at base, upgraded with runes/souls/relics to .' + ev.lvl;
    const altNote = ev.altRoute
      ? el('p', { class: 'muted small' },
          (ev.altRoute.route === 'direct' ? 'Direct crafting' : 'The upgrade path') + ' would cost ' +
          (ev.altRoute.ok ? fmtSilverFull(ev.altRoute.perItem) + ' — ' +
            (ev.altRoute.perItem > ev.route.perItem
              ? fmtSilverFull(ev.altRoute.perItem - ev.route.perItem) + ' more.'
              : 'cheaper, but missing price data prevented using it.')
          : 'an unknown amount (missing price data).'))
      : null;

    const chartCanvas = el('canvas', { class: 'history-chart' });
    const scaleBtns = el('div', { class: 'scale-btns' });
    let curScale = 24;
    [['1', 'Hourly'], ['6', '6-hour'], ['24', 'Daily']].forEach(([s, label]) => {
      const b = el('button', { class: 'btn small' + (+s === 24 ? ' primary' : ''), type: 'button' }, label);
      b.addEventListener('click', () => {
        curScale = +s;
        scaleBtns.querySelectorAll('.btn').forEach(x => x.classList.remove('primary'));
        b.classList.add('primary');
        loadChart();
      });
      scaleBtns.append(b);
    });
    const chartStatus = el('div', { class: 'muted small chart-status' }, 'Loading price history…');
    function loadChart() {
      chartStatus.textContent = 'Loading price history…';
      AODP.history(STATE.get('server'), ev.id, ctx.city, curScale).then(points => {
        chartStatus.textContent = points.length ? '' : '';
        CHART.render(chartCanvas, points);
      }).catch(() => { chartStatus.textContent = 'Could not load price history.'; });
    }

    const betterNote = ev.better
      ? el('p', { class: 'flag warn' }, 'Sells for ' + fmtSilver(ev.better.net) + ' net in ' + ev.better.city +
          ' — ' + fmtSilver(ev.better.net - ev.revenue) + ' more than ' + ctx.city + '.')
      : null;

    // --- track this craft ---
    const trackQty = el('input', { type: 'number', min: '1', value: '10', style: 'width:90px', 'aria-label': 'Quantity to craft' });
    const trackBtn = el('button', { class: 'btn primary', type: 'button' }, '+ Track this craft');
    const trackMsg = el('span', { class: 'muted small' });
    trackBtn.addEventListener('click', () => {
      const qty = Math.max(1, Math.floor(+trackQty.value || 1));
      STATE.addTracked(ev.uid, ev.lvl, qty);
      updateTrackerBadge();
      UTIL.clear(trackMsg);
      trackMsg.append('Added — ', el('a', { href: 'tracker.html' }, 'open the Tracker'), ' for the full material plan.');
    });
    const trackSection = el('div', { class: 'track-box' },
      el('span', { class: 'muted small' }, 'Planning to craft this?'),
      trackQty, trackBtn, trackMsg);

    const content = el('div', {},
      el('div', { class: 'modal-title' },
        iconImg(ev.id, 44),
        tierChip(ev.tier, ev.lvl),
        el('h2', {}, ev.name),
        el('span', { class: 'muted' }, ECON.CAT_LABELS[item.c] || item.c),
      ),
      cityNote,
      el('div', { class: 'profit-summary' },
        stat('Craft cost', fmtSilverFull(ev.cost) + ' ', 'per item · ' + routeLabel),
        stat('Sell price', ev.gross > 0 ? fmtSilverFull(ev.gross) : 'no data', ctx.city + ' · ' + fmtAge(ev.priceAge)),
        stat('Net after fees', fmtSilverFull(ev.revenue), fmtPct(ECON.salesTax(ctx), 0) + ' tax + 2.5% setup'),
        stat('Profit', fmtSilverFull(ev.profit), ev.roi !== null ? fmtPct(ev.roi, 1) + ' return' : '', ev.profit >= 0 ? 'good' : 'bad'),
      ),
      betterNote,
      trackSection,
      el('h3', {}, 'Cost breakdown'),
      el('p', { class: 'muted small' },
        'Resource return: ' + fmtPct(rr.rate, 0) + (rr.capped ? ' (capped from ' + fmtPct(rr.raw, 0) + ')' : '') +
        (rr.spec ? ' incl. city specialty bonus' : '') + (ctx.focus ? ' incl. Focus' : '') +
        (ev.route.batch > 1 ? ' · recipe crafts ' + ev.route.batch + ' per batch (costs shown per batch, cost/item = batch ÷ ' + ev.route.batch + ')' : '')),
      el('table', { class: 'data-table breakdown' },
        el('thead', {}, el('tr', {},
          el('th', {}, 'Material'), el('th', { class: 'num' }, 'Qty'), el('th', { class: 'num' }, 'Eff. qty'),
          el('th', { class: 'num' }, 'Unit'), el('th', { class: 'num' }, 'Cost'))),
        el('tbody', {}, rows),
      ),
      altNote,
      el('h3', {}, 'Price history — ' + ctx.city),
      scaleBtns,
      el('div', { class: 'chart-wrap' }, chartCanvas),
      chartStatus,
      el('p', { class: 'muted tiny' }, 'Assumes materials bought at lowest sell order and output sold by sell order (Black Market: sold to buy orders, no setup fee). Station usage fees not modelled in v1.'),
    );
    openModal(content, 'item-modal');
    loadChart();
  }

  function stat(label, value, sub, cls) {
    return el('div', { class: 'stat ' + (cls || '') },
      el('div', { class: 'stat-label' }, label),
      el('div', { class: 'stat-value' }, value),
      sub ? el('div', { class: 'stat-sub muted' }, sub) : null,
    );
  }

  function renderFooter() {
    document.body.append(el('footer', { class: 'site-footer' },
      el('p', {}, 'Craft Ledger · market data from the ',
        el('a', { href: 'https://www.albion-online-data.com', target: '_blank', rel: 'noopener' }, 'Albion Online Data Project'),
        ' · item data from ',
        el('a', { href: 'https://github.com/ao-data/ao-bin-dumps', target: '_blank', rel: 'noopener' }, 'ao-bin-dumps'),
        '. Not affiliated with Sandbox Interactive.'),
    ));
  }

  return { renderHeader, renderFooter, ensureSetup, openModal, openItemModal, tierChip, enchChip, stat, iconUrl, iconImg, updateTrackerBadge };
})();
