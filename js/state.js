// Craft Ledger — persisted settings + inventory (localStorage)
'use strict';

window.STATE = (function () {
  const KEY = 'craftledger.v1';

  const DEFAULTS = {
    server: null,          // 'americas' | 'europe' | 'asia'
    city: null,            // one of ECON.CITIES
    premium: false,
    focus: false,
    // Station usage fee, % of item value — out of scope for v1 but the econ
    // model already accepts it, so it stays here as a future adjustable input.
    stationFeePct: 0,
    materials: [],         // [{id: catalogUid, qty: number}]
    tracked: [],           // [{uid, lvl, qty}] — crafts being planned on the Tracker page
    filters: { tier: 'all', ench: 'all', cat: 'all' },
  };

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { /* corrupted storage — start fresh */ }
    return Object.assign({}, DEFAULTS);
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* full/blocked */ }
  }

  function get(k) { return state[k]; }
  function set(k, v) { state[k] = v; save(); }
  function all() { return state; }

  function isSetup() { return !!(state.server && state.city); }

  // --- inventory helpers (My Materials) ---
  function addMaterial(id, qty) {
    const found = state.materials.find(m => m.id === id);
    if (found) found.qty += qty; else state.materials.push({ id: id, qty: qty });
    if (found && found.qty <= 0) removeMaterial(id);
    save();
  }
  function setMaterialQty(id, qty) {
    const found = state.materials.find(m => m.id === id);
    if (found) { found.qty = qty; if (qty <= 0) removeMaterial(id); save(); }
  }
  function removeMaterial(id) {
    state.materials = state.materials.filter(m => m.id !== id);
    save();
  }

  // --- tracked crafts (Tracker page) ---
  function addTracked(uid, lvl, qty) {
    const found = state.tracked.find(t => t.uid === uid && t.lvl === lvl);
    if (found) found.qty = qty; else state.tracked.push({ uid: uid, lvl: lvl, qty: qty });
    save();
  }
  function setTrackedQty(uid, lvl, qty) {
    const found = state.tracked.find(t => t.uid === uid && t.lvl === lvl);
    if (found) { found.qty = qty; save(); }
  }
  function removeTracked(uid, lvl) {
    state.tracked = state.tracked.filter(t => !(t.uid === uid && t.lvl === lvl));
    save();
  }

  return { get, set, all, isSetup, addMaterial, setMaterialQty, removeMaterial, addTracked, setTrackedQty, removeTracked };
})();
