// Craft Ledger — tiny canvas price-history chart (no dependencies).
// Line = average price, faint bars = volume, hover crosshair with values.
'use strict';

window.CHART = (function () {

  function draw(canvas, points, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = canvas.clientHeight || 260;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 56, padR = 12, padT = 12, padB = 26;
    const W = cssW - padL - padR, H = cssH - padT - padB;

    ctx.font = '11px "IBM Plex Sans", sans-serif';
    if (!points || points.length < 2) {
      ctx.fillStyle = 'rgba(232,228,212,.55)';
      ctx.textAlign = 'center';
      ctx.fillText('No price history available for this market.', cssW / 2, cssH / 2);
      return null;
    }

    const prices = points.map(p => p.avg_price);
    const counts = points.map(p => p.item_count || 0);
    let pMin = Math.min.apply(null, prices), pMax = Math.max.apply(null, prices);
    if (pMin === pMax) { pMin *= 0.9; pMax *= 1.1; }
    const span = pMax - pMin;
    pMin -= span * 0.08; pMax += span * 0.08;
    const cMax = Math.max.apply(null, counts) || 1;

    const x = i => padL + (i / (points.length - 1)) * W;
    const y = v => padT + H - ((v - pMin) / (pMax - pMin)) * H;

    // gridlines + y labels
    ctx.strokeStyle = 'rgba(201,169,89,.14)';
    ctx.fillStyle = 'rgba(232,228,212,.6)';
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    for (let g = 0; g <= 4; g++) {
      const v = pMin + (g / 4) * (pMax - pMin);
      const yy = y(v);
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + W, yy); ctx.stroke();
      ctx.fillText(UTIL.fmtSilver(v), padL - 6, yy + 3);
    }

    // volume bars
    const bw = Math.max(1, W / points.length - 2);
    ctx.fillStyle = 'rgba(127,176,105,.22)';
    points.forEach((p, i) => {
      const h = ((p.item_count || 0) / cMax) * (H * 0.35);
      ctx.fillRect(x(i) - bw / 2, padT + H - h, bw, h);
    });

    // price line
    ctx.strokeStyle = '#c9a959';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => { i ? ctx.lineTo(x(i), y(p.avg_price)) : ctx.moveTo(x(i), y(p.avg_price)); });
    ctx.stroke();

    // x labels: first / middle / last
    ctx.fillStyle = 'rgba(232,228,212,.6)';
    ctx.textAlign = 'center';
    [0, Math.floor(points.length / 2), points.length - 1].forEach(i => {
      const t = points[i].timestamp;
      const d = new Date(t.endsWith('Z') ? t : t + 'Z');
      const label = (d.getMonth() + 1) + '/' + d.getDate();
      ctx.fillText(label, x(i), padT + H + 16);
    });

    return { x: x, y: y, padL: padL, padT: padT, W: W, H: H, points: points };
  }

  // attach hover crosshair; re-call after each draw
  function bindHover(canvas, layout, points) {
    canvas.onmousemove = function (ev) {
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      draw(canvas, points); // redraw clean
      const lay = layout;
      const i = Math.max(0, Math.min(points.length - 1,
        Math.round((mx - lay.padL) / lay.W * (points.length - 1))));
      const p = points[i];
      const ctx = canvas.getContext('2d');
      const px = lay.x(i), py = lay.y(p.avg_price);
      ctx.strokeStyle = 'rgba(232,228,212,.35)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(px, lay.padT); ctx.lineTo(px, lay.padT + lay.H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#c9a959';
      ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
      const t = p.timestamp;
      const d = new Date(t.endsWith('Z') ? t : t + 'Z');
      const label = (d.getMonth() + 1) + '/' + d.getDate() + ' — ' + UTIL.fmtSilverFull(p.avg_price) +
        ' silver · ' + (p.item_count || 0) + ' sold';
      ctx.font = '11px "IBM Plex Sans", sans-serif';
      const tw = ctx.measureText(label).width + 12;
      let bx = Math.min(Math.max(px - tw / 2, lay.padL), lay.padL + lay.W - tw);
      ctx.fillStyle = 'rgba(16,26,18,.92)';
      ctx.strokeStyle = 'rgba(201,169,89,.5)';
      ctx.beginPath(); ctx.roundRect(bx, 2, tw, 18, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e8e4d4';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 6, 15);
    };
    canvas.onmouseleave = function () { draw(canvas, points); };
  }

  function render(canvas, points) {
    const layout = draw(canvas, points);
    if (layout) bindHover(canvas, layout, points);
  }

  return { render };
})();
