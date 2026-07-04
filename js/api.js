// Craft Ledger — Albion Online Data Project client.
// Batches item ids into as few calls as possible (comma-separated, under the
// URL length limit), throttles below AODP's 180 req/min, and caches responses
// so re-renders / filter changes never re-fetch.
'use strict';

window.AODP = (function () {
  const SERVERS = {
    americas: 'https://west.albion-online-data.com',
    europe: 'https://europe.albion-online-data.com',
    asia: 'https://east.albion-online-data.com',
  };
  const SERVER_LABELS = { americas: 'Americas', europe: 'Europe', asia: 'Asia' };

  const TTL = 5 * 60 * 1000;      // price cache lifetime
  const MAX_URL = 3800;           // stay safely under the ~4096 char limit
  const MIN_GAP = 400;            // ms between requests (~150/min max)

  // cache: "server|itemId|city" -> {row, at}
  const cache = new Map();
  let lastReq = 0;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function throttledJson(url, attempt) {
    const wait = lastReq + MIN_GAP - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    const res = await fetch(url);
    if (res.status === 429 && (attempt || 0) < 3) {
      await sleep(8000 * ((attempt || 0) + 1));   // backing off hard on rate limit
      return throttledJson(url, (attempt || 0) + 1);
    }
    if (!res.ok) throw new Error('AODP request failed (' + res.status + ')');
    return res.json();
  }

  function cacheKey(server, id, city) { return server + '|' + id + '|' + city; }

  // Fetch current prices for ids × cities. Returns Map "id|city" -> row.
  // Rows are AODP price objects; combos AODP doesn't return come back as
  // zeroed rows so callers can treat "no data" uniformly.
  async function prices(server, ids, cities, onProgress) {
    const base = SERVERS[server];
    if (!base) throw new Error('Unknown server ' + server);
    const out = new Map();
    const now = Date.now();

    const need = [];
    for (const id of ids) {
      let allCached = true;
      for (const c of cities) {
        const hit = cache.get(cacheKey(server, id, c));
        if (hit && now - hit.at < TTL) out.set(id + '|' + c, hit.row);
        else allCached = false;
      }
      if (!allCached) need.push(id);
    }

    if (need.length) {
      const locParam = cities.map(encodeURIComponent).join(',');
      const fixed = base.length + '/api/v2/stats/prices/.json?locations=&qualities=1'.length + locParam.length;
      const chunks = [];
      let cur = [], curLen = 0;
      for (const id of need) {
        const addLen = encodeURIComponent(id).length + 3; // id + comma (@ encodes to %40)
        if (cur.length && fixed + curLen + addLen > MAX_URL) { chunks.push(cur); cur = []; curLen = 0; }
        cur.push(id); curLen += addLen;
      }
      if (cur.length) chunks.push(cur);

      let done = 0;
      if (onProgress) onProgress(0, chunks.length);
      for (const chunk of chunks) {
        const url = base + '/api/v2/stats/prices/' +
          chunk.map(encodeURIComponent).join(',') + '.json?locations=' + locParam + '&qualities=1';
        const rows = await throttledJson(url);
        const seen = new Set();
        for (const row of rows) {
          if (row.quality > 1) continue;
          cache.set(cacheKey(server, row.item_id, row.city), { row: row, at: Date.now() });
          out.set(row.item_id + '|' + row.city, row);
          seen.add(row.item_id + '|' + row.city);
        }
        // fill gaps with empty rows so we don't refetch them this session
        for (const id of chunk) for (const c of cities) {
          const k = id + '|' + c;
          if (!seen.has(k) && !out.has(k)) {
            const empty = { item_id: id, city: c, quality: 1, sell_price_min: 0, buy_price_max: 0 };
            cache.set(cacheKey(server, id, c), { row: empty, at: Date.now() });
            out.set(k, empty);
          }
        }
        done++;
        if (onProgress) onProgress(done, chunks.length);
      }
    }
    return out;
  }

  // Historical prices for one item in one city.
  // scale: 1 (hourly), 6, or 24 (daily). Returns [{timestamp, avg_price, item_count}]
  async function history(server, id, city, scale) {
    const base = SERVERS[server];
    const url = base + '/api/v2/stats/history/' + encodeURIComponent(id) +
      '.json?locations=' + encodeURIComponent(city) + '&qualities=1&time-scale=' + (scale || 24);
    const rows = await throttledJson(url);
    for (const r of rows) {
      if (r.location === city && (r.quality === 1 || r.quality === 0)) return r.data || [];
    }
    return rows.length ? (rows[0].data || []) : [];
  }

  function clearCache() { cache.clear(); }

  return { SERVERS, SERVER_LABELS, prices, history, clearCache, TTL };
})();
