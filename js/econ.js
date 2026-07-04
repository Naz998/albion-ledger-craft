// Craft Ledger — economic model.
//
// Conventions (shown to the user in the UI footnote):
//  - Materials are bought instantly at the lowest sell order (sell_price_min).
//  - Finished goods are sold via a sell order: 2.5% setup fee + sales tax
//    (8%, or 4% with Premium). Black Market sales fill existing buy orders
//    (buy_price_max), so only sales tax applies there.
//  - Resource return: 18% base in every royal city, +40% refining the city's
//    specialty resource / +15% crafting the city's specialty items, +59% flat
//    with Focus. Additive per the model spec, capped at 75% so costs stay
//    meaningful. Return never applies to upgrade materials (runes/souls/
//    relics) or ingredients the game flags as non-returnable (e.g. animals).
//  - Station usage fee is a parameter (stationFeePct of item value) that is
//    always 0 in v1 — kept in the signatures so it can become a user input.
'use strict';

window.ECON = (function () {
  const D = window.CRAFT_LEDGER_DATA;

  const SETUP_FEE = 0.025;
  const TAX_NORMAL = 0.08, TAX_PREMIUM = 0.04;
  const BASE_RETURN = 0.18, REFINE_SPEC = 0.40, CRAFT_SPEC = 0.15, FOCUS_BONUS = 0.59;
  const RETURN_CAP = 0.75;

  const CITIES = ['Caerleon', 'Bridgewatch', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien'];
  const BLACK_MARKET = 'Black Market';
  // Black Market only buys combat equipment
  const BM_CATS = { melee: 1, ranged: 1, magic: 1, offhand: 1, armor: 1 };

  const CATEGORY_GROUPS = [
    ['Combat Gear', [['melee', 'Melee Weapons'], ['ranged', 'Ranged Weapons'], ['magic', 'Magic Weapons'], ['offhand', 'Off-Hand Items'], ['armor', 'Armor']]],
    ['Accessories', [['bags_capes', 'Bags & Capes']]],
    ['Utility', [['tools', 'Tools'], ['mounts', 'Mounts']]],
    ['Consumables', [['food', 'Food'], ['potions', 'Potions']]],
    ['Materials', [['raw', 'Raw Materials'], ['refined', 'Refined Materials']]],
  ];
  const CAT_LABELS = {};
  CATEGORY_GROUPS.forEach(g => g[1].forEach(c => { CAT_LABELS[c[0]] = c[1]; }));

  const REFINE_CITY = { wood: 'Fort Sterling', fiber: 'Lymhurst', hide: 'Martlock', stone: 'Bridgewatch', ore: 'Thetford' };
  const CRAFT_CITY_BY_SUB = {
    hammer: 'Fort Sterling', spear: 'Fort Sterling', holystaff: 'Fort Sterling', plate_helmet: 'Fort Sterling', cloth_armor: 'Fort Sterling',
    sword: 'Lymhurst', bow: 'Lymhurst', arcanestaff: 'Lymhurst', leather_helmet: 'Lymhurst', leather_shoes: 'Lymhurst',
    axe: 'Martlock', quarterstaff: 'Martlock', froststaff: 'Martlock', plate_shoes: 'Martlock',
    crossbow: 'Bridgewatch', dagger: 'Bridgewatch', cursestaff: 'Bridgewatch', plate_armor: 'Bridgewatch', cloth_shoes: 'Bridgewatch',
    mace: 'Thetford', firestaff: 'Thetford', naturestaff: 'Thetford', leather_armor: 'Thetford', cloth_helmet: 'Thetford',
    knuckles: 'Caerleon', shapeshifterstaff: 'Caerleon',
  };

  // City whose bonus applies to this catalog item (null = no city bonus)
  function bonusCity(item) {
    switch (item.c) {
      case 'refined': return REFINE_CITY[item.s] || null;
      case 'offhand': return 'Martlock';
      case 'tools': return 'Caerleon';
      case 'food': return 'Caerleon';
      case 'potions': return 'Brecilien';
      case 'bags_capes': return 'Brecilien';
      case 'mounts': return null;
      case 'armor': return item.s.indexOf('gatherer_') === 0 ? 'Caerleon' : (CRAFT_CITY_BY_SUB[item.s] || null);
      default: return CRAFT_CITY_BY_SUB[item.s] || null;
    }
  }

  // Effective resource-return rate for crafting/refining this item in ctx.city
  function returnRate(item, ctx) {
    let rate = BASE_RETURN;
    let spec = false;
    if (bonusCity(item) === ctx.city) {
      spec = true;
      rate += item.c === 'refined' ? REFINE_SPEC : CRAFT_SPEC;
    }
    if (ctx.focus) rate += FOCUS_BONUS;
    const capped = rate > RETURN_CAP;
    return { rate: Math.min(rate, RETURN_CAP), raw: rate, spec: spec, capped: capped };
  }

  // ---- market ids -------------------------------------------------------
  // Enchantment rides on the item id: gear/consumables get "@N"; enchanted
  // resources already carry _LEVELN in their uniquename and get "@N" too.
  function marketId(uid, lvl) { return lvl ? uid + '@' + lvl : uid; }

  function ingMarketId(uid) {
    const m = /_LEVEL(\d)$/.exec(uid);
    return m ? uid + '@' + m[1] : uid;
  }

  function ingName(uid) {
    if (D.items[uid]) return D.items[uid].n;
    if (D.ingredients[uid]) return D.ingredients[uid].n;
    if (D.raw[uid]) return D.raw[uid].n;
    return uid;
  }

  // ---- pricing helpers --------------------------------------------------
  // ctx = { prices: Map "id|city"->row, city, premium, focus, stationFeePct }
  function priceRow(ctx, id, city) {
    return ctx.prices.get(id + '|' + (city || ctx.city)) || null;
  }
  function sellPrice(ctx, id, city) {
    const r = priceRow(ctx, id, city);
    return r && r.sell_price_min > 0 ? r.sell_price_min : 0;
  }

  function salesTax(ctx) { return ctx.premium ? TAX_PREMIUM : TAX_NORMAL; }
  // Net revenue selling one unit via sell order in a royal city
  function netSell(ctx, gross) { return gross * (1 - SETUP_FEE - salesTax(ctx)); }
  // Net revenue selling into a Black Market buy order (no order setup fee)
  function netSellBM(ctx, gross) { return gross * (1 - salesTax(ctx)); }

  // Unit cost of an ingredient in ctx.city. Refined materials may be cheaper
  // to refine from raws than to buy — take the cheaper and remember which.
  function materialUnitCost(uid, ctx, memo, stack) {
    memo = memo || ctx._matMemo || (ctx._matMemo = {});
    if (memo[uid]) return memo[uid];
    stack = stack || {};
    const market = sellPrice(ctx, ingMarketId(uid));
    let result = { unit: market, src: 'market', ok: market > 0 };

    const item = D.items[uid];
    if (item && item.c === 'refined' && !stack[uid]) {
      stack[uid] = 1;
      const craft = refineUnitCost(item, uid, ctx, memo, stack);
      delete stack[uid];
      if (craft.ok && (!result.ok || craft.unit < result.unit)) {
        result = { unit: craft.unit, src: 'craft', ok: true };
      }
    }
    memo[uid] = result;
    return result;
  }

  function refineUnitCost(item, uid, ctx, memo, stack) {
    const rx = item.rx['0'];
    if (!rx) return { ok: false };
    const rr = returnRate(item, ctx).rate;
    let total = 0;
    for (const ing of rx.in) {
      const c = materialUnitCost(ing[0], ctx, memo, stack);
      if (!c.ok) return { ok: false };
      const eff = ing[2] ? ing[1] : ing[1] * (1 - rr);
      total += eff * c.unit;
    }
    const out = sellPrice(ctx, marketId(uid, item.el || 0));
    total += (ctx.stationFeePct || 0) / 100 * out; // v1: always 0
    return { ok: true, unit: total / (rx.b || 1) };
  }

  // ---- route costing ----------------------------------------------------
  // Cost per single finished item for the "direct" route (craft at this
  // enchant level from matching materials).
  function directCost(item, uid, lvl, ctx) {
    // enchanted resources carry their level in the uniquename (item.el);
    // their single recipe is stored under key '0'
    const rx = item.rx[item.el != null ? '0' : String(lvl)];
    if (!rx) return null;
    const rrInfo = returnRate(item, ctx);
    const rows = [];
    const missing = [];
    let total = 0;
    for (const ing of rx.in) {
      const c = materialUnitCost(ing[0], ctx);
      const eff = ing[2] ? ing[1] : ing[1] * (1 - rrInfo.rate);
      rows.push({ id: ing[0], name: ingName(ing[0]), qty: ing[1], eff: eff, unit: c.unit, src: c.src, total: eff * c.unit, noReturn: !!ing[2] });
      if (!c.ok) missing.push(ing[0]);
      total += eff * c.unit;
    }
    const batch = rx.b || 1;
    return { route: 'direct', ok: missing.length === 0, perItem: total / batch, batch: batch, rows: rows, missing: missing, rr: rrInfo };
  }

  // Upgrade route: craft the base item, then apply runes → souls → relics
  // sequentially up to lvl (only exists for gear, lvl 1–3; .4 is direct-only).
  function upgradeEligible(item, lvl) {
    if (!item.up || lvl < 1 || lvl > 3) return false;
    for (let i = 1; i <= lvl; i++) {
      const step = item.up[String(i)];
      if (!step) return false;
      for (const u of step) if (!/_(RUNE|SOUL|RELIC)$/.test(u[0])) return false;
    }
    return true;
  }

  function upgradeCost(item, uid, lvl, ctx) {
    if (!upgradeEligible(item, lvl)) return null;
    const base = directCost(item, uid, 0, ctx);
    if (!base) return null;
    const rows = base.rows.slice();
    const missing = base.missing.slice();
    let total = base.perItem; // gear batch is 1
    for (let i = 1; i <= lvl; i++) {
      for (const u of item.up[String(i)]) {
        const unit = sellPrice(ctx, ingMarketId(u[0]));
        rows.push({ id: u[0], name: ingName(u[0]), qty: u[1], eff: u[1], unit: unit, src: 'market', total: u[1] * unit, noReturn: true, upgradeStep: i });
        if (!(unit > 0)) missing.push(u[0]);
        total += u[1] * unit;
      }
    }
    return { route: 'upgrade', ok: missing.length === 0, perItem: total, batch: 1, rows: rows, missing: missing, rr: base.rr };
  }

  // ---- evaluation -------------------------------------------------------
  // Full craft-to-sell evaluation of one item at one enchant level.
  function evaluate(uid, lvl, ctx) {
    const item = D.items[uid];
    if (!item) return null;
    const id = marketId(uid, lvl);

    const routes = [];
    const direct = directCost(item, uid, lvl, ctx);
    if (direct) routes.push(direct);
    if (lvl >= 1 && lvl <= 3) {
      const upg = upgradeCost(item, uid, lvl, ctx);
      if (upg) routes.push(upg);
    }
    if (!routes.length) return null;

    const usable = routes.filter(r => r.ok);
    const best = (usable.length ? usable : routes).reduce((a, b) => (a.perItem <= b.perItem ? a : b));
    const alt = routes.length > 1 ? routes.find(r => r !== best) : null;

    const row = priceRow(ctx, id);
    const gross = row && row.sell_price_min > 0 ? row.sell_price_min : 0;
    const revenue = netSell(ctx, gross);
    const profit = revenue - best.perItem;

    // Would another city (or the Black Market, for combat gear) pay meaningfully more?
    let better = null;
    const bmOk = !!BM_CATS[item.c];
    const alts = CITIES.filter(c => c !== ctx.city).map(c => {
      const g = sellPrice(ctx, id, c);
      return { city: c, net: g > 0 ? netSell(ctx, g) : 0 };
    });
    if (bmOk) {
      const r = priceRow(ctx, id, BLACK_MARKET);
      const g = r && r.buy_price_max > 0 ? r.buy_price_max : 0;
      alts.push({ city: BLACK_MARKET, net: g > 0 ? netSellBM(ctx, g) : 0 });
    }
    for (const a of alts) {
      if (a.net > revenue * 1.05 && a.net - revenue > 500 && (!better || a.net > better.net)) better = a;
    }

    return {
      uid: uid, lvl: lvl, id: id, item: item,
      name: item.n, tier: item.t, cat: item.c,
      cost: best.perItem, route: best, altRoute: alt,
      gross: gross, revenue: revenue, profit: profit,
      roi: best.perItem > 0 ? profit / best.perItem : null,
      priceAge: row ? row.sell_price_min_date : null,
      hasPrice: gross > 0, ok: best.ok && gross > 0,
      better: better, bmEligible: bmOk,
    };
  }

  // Reset the per-pass material-cost memo (call when ctx/prices change)
  function freshCtx(prices) {
    return {
      prices: prices,
      city: STATE.get('city'),
      premium: STATE.get('premium'),
      focus: STATE.get('focus'),
      stationFeePct: STATE.get('stationFeePct') || 0,
    };
  }

  // Every market id a full-catalog scan needs (finished goods per enchant level)
  function allOutputIds() {
    const set = {};
    for (const uid in D.items) {
      const item = D.items[uid];
      if (item.el != null) { set[marketId(uid, item.el)] = 1; continue; }
      for (const lvl in item.rx) set[marketId(uid, +lvl)] = 1;
      if (item.up) for (const lvl in item.up) set[marketId(uid, +lvl)] = 1;
    }
    return Object.keys(set);
  }

  // Every ingredient market id referenced by any recipe/upgrade
  function allIngredientIds() {
    const set = {};
    for (const uid in D.items) {
      const item = D.items[uid];
      for (const lvl in item.rx) for (const ing of item.rx[lvl].in) set[ingMarketId(ing[0])] = 1;
      if (item.up) for (const lvl in item.up) for (const u of item.up[lvl]) set[ingMarketId(u[0])] = 1;
    }
    return Object.keys(set);
  }

  return {
    SETUP_FEE, TAX_NORMAL, TAX_PREMIUM, BASE_RETURN, REFINE_SPEC, CRAFT_SPEC, FOCUS_BONUS, RETURN_CAP,
    CITIES, BLACK_MARKET, BM_CATS, CATEGORY_GROUPS, CAT_LABELS, REFINE_CITY,
    bonusCity, returnRate, marketId, ingMarketId, ingName,
    salesTax, netSell, netSellBM, materialUnitCost,
    directCost, upgradeCost, upgradeEligible, evaluate, freshCtx,
    allOutputIds, allIngredientIds,
  };
})();
