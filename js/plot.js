/**
 * plot.js — власний графічний рушій на HTML5 Canvas (без бібліотек).
 * Адаптивне полотно з урахуванням devicePixelRatio, перетворення координат,
 * автомасштабування осей X/Y, «красива» сітка з підписами, криві, маркери, залишки.
 */
(function (global) {
  'use strict';

  const COLORS = {
    points: '#111827',
    interp: '#2563eb',
    lsm: { 1: '#ea580c', 2: '#16a34a', 3: '#db2777', 4: '#7c3aed' },
    residual: '#dc2626',
    active: '#f43f5e',
    grid: '#e5e7eb',
    axis: '#6b7280',
    text: '#374151',
    extrap: 'rgba(250, 204, 21, 0.10)'
  };

  /** «Красивий» крок сітки: 1, 2, 5 × 10^k. */
  function niceStep(range, ticks) {
    const raw = range / Math.max(1, ticks);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nf * pow;
  }

  function fmt(v) {
    if (Math.abs(v) < 1e-12) return '0';
    const a = Math.abs(v);
    if (a >= 1e4 || a < 1e-3) return v.toExponential(1);
    return String(+v.toFixed(3));
  }

  /**
   * Автомасштабування: межі обчислюються з точок і з кривих, що зараз видимі.
   * Значення кривих, які «відлітають» (ефект Рунге, екстраполяція) далі ніж на
   * clampRatio·діапазон даних, не розтягують осі — криву просто обрізає область графіка.
   */
  function computeViewport(points, fns, opts) {
    const o = Object.assign({ pad: 0.1, xPad: 0.08, clampRatio: 0.6, samples: 160 }, opts || {});
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    let xMin = Math.min(...xs), xMax = Math.max(...xs);
    const xSpan = xMax - xMin || 1;
    xMin -= xSpan * o.xPad; xMax += xSpan * o.xPad;

    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    const ySpan0 = yMax - yMin || 1;
    const lo = yMin - ySpan0 * o.clampRatio, hi = yMax + ySpan0 * o.clampRatio;
    (fns || []).forEach(fn => {
      for (let i = 0; i <= o.samples; i++) {
        const x = xMin + (xMax - xMin) * i / o.samples;
        const y = fn(x);
        if (!Number.isFinite(y)) continue;
        const yc = Math.min(hi, Math.max(lo, y));
        if (yc < yMin) yMin = yc;
        if (yc > yMax) yMax = yc;
      }
    });
    const ySpan = yMax - yMin || 1;
    return { xMin, xMax, yMin: yMin - ySpan * o.pad, yMax: yMax + ySpan * o.pad };
  }

  /** Плавне наближення поточних меж до цільових (щоб осі не «смикались» в анімації). */
  function lerpViewport(cur, target, k) {
    if (!cur) return Object.assign({}, target);
    const r = {};
    for (const key of ['xMin', 'xMax', 'yMin', 'yMax']) r[key] = cur[key] + (target[key] - cur[key]) * k;
    return r;
  }

  function viewportClose(a, b) {
    if (!a || !b) return false;
    const sx = (b.xMax - b.xMin) * 1e-3, sy = (b.yMax - b.yMin) * 1e-3;
    return Math.abs(a.xMin - b.xMin) < sx && Math.abs(a.xMax - b.xMax) < sx &&
           Math.abs(a.yMin - b.yMin) < sy && Math.abs(a.yMax - b.yMax) < sy;
  }

  class Plot {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.margin = Object.assign({ l: 58, r: 14, t: 14, b: 38 }, (opts && opts.margin) || {});
      this.compact = !!(opts && opts.compact);
      this.vp = { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
      this.resize();
    }

    /** Адаптивне полотно: розмір з CSS × devicePixelRatio, трансформація задається абсолютно. */
    resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      this.w = Math.max(50, rect.width);
      this.h = Math.max(50, rect.height);
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    setViewport(vp) { this.vp = vp; }

    get plotW() { return this.w - this.margin.l - this.margin.r; }
    get plotH() { return this.h - this.margin.t - this.margin.b; }

    sx(x) { return this.margin.l + (x - this.vp.xMin) / (this.vp.xMax - this.vp.xMin) * this.plotW; }
    sy(y) { return this.margin.t + (this.vp.yMax - y) / (this.vp.yMax - this.vp.yMin) * this.plotH; }
    invX(px) { return this.vp.xMin + (px - this.margin.l) / this.plotW * (this.vp.xMax - this.vp.xMin); }
    invY(py) { return this.vp.yMax - (py - this.margin.t) / this.plotH * (this.vp.yMax - this.vp.yMin); }

    clear() {
      const c = this.ctx;
      c.clearRect(0, 0, this.w, this.h);
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, this.w, this.h);
    }

    clipPlot(fn) {
      const c = this.ctx;
      c.save();
      c.beginPath();
      c.rect(this.margin.l, this.margin.t, this.plotW, this.plotH);
      c.clip();
      fn(c);
      c.restore();
    }

    /** Затінення зон екстраполяції (за межами [x0, xn]). */
    drawExtrapolationZones(xFirst, xLast) {
      this.clipPlot(c => {
        c.fillStyle = COLORS.extrap;
        const top = this.margin.t, h = this.plotH;
        const a = this.sx(xFirst), b = this.sx(xLast);
        if (a > this.margin.l) c.fillRect(this.margin.l, top, a - this.margin.l, h);
        if (b < this.margin.l + this.plotW) c.fillRect(b, top, this.margin.l + this.plotW - b, h);
      });
    }

    /** Сітка, осі, числові підписи та назви осей. */
    drawGrid(xLabel, yLabel) {
      const c = this.ctx, vp = this.vp;
      const fs = this.compact ? 10 : 11;
      c.font = `${fs}px system-ui, sans-serif`;
      const xStep = niceStep(vp.xMax - vp.xMin, Math.max(3, Math.floor(this.plotW / 80)));
      const yStep = niceStep(vp.yMax - vp.yMin, Math.max(3, Math.floor(this.plotH / 50)));

      c.lineWidth = 1;
      c.strokeStyle = COLORS.grid;
      c.fillStyle = COLORS.text;
      c.textAlign = 'center';
      c.textBaseline = 'top';
      for (let x = Math.ceil(vp.xMin / xStep) * xStep; x <= vp.xMax + 1e-9; x += xStep) {
        const px = Math.round(this.sx(x)) + 0.5;
        c.beginPath(); c.moveTo(px, this.margin.t); c.lineTo(px, this.margin.t + this.plotH); c.stroke();
        c.fillText(fmt(x), px, this.margin.t + this.plotH + 4);
      }
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      for (let y = Math.ceil(vp.yMin / yStep) * yStep; y <= vp.yMax + 1e-9; y += yStep) {
        const py = Math.round(this.sy(y)) + 0.5;
        c.beginPath(); c.moveTo(this.margin.l, py); c.lineTo(this.margin.l + this.plotW, py); c.stroke();
        c.fillText(fmt(y), this.margin.l - 6, py);
      }

      // Осі x = 0 та y = 0, якщо вони у видимій зоні
      c.strokeStyle = COLORS.axis;
      c.lineWidth = 1.3;
      if (vp.yMin < 0 && vp.yMax > 0) {
        const py = this.sy(0);
        c.beginPath(); c.moveTo(this.margin.l, py); c.lineTo(this.margin.l + this.plotW, py); c.stroke();
      }
      if (vp.xMin < 0 && vp.xMax > 0) {
        const px = this.sx(0);
        c.beginPath(); c.moveTo(px, this.margin.t); c.lineTo(px, this.margin.t + this.plotH); c.stroke();
      }
      c.strokeRect(this.margin.l, this.margin.t, this.plotW, this.plotH);

      // Назви осей
      c.fillStyle = COLORS.text;
      c.font = `italic ${fs + 1}px system-ui, sans-serif`;
      if (xLabel) {
        c.textAlign = 'right'; c.textBaseline = 'bottom';
        c.fillText(xLabel, this.margin.l + this.plotW, this.h - 2);
      }
      if (yLabel) {
        c.save();
        c.translate(12, this.margin.t + this.plotH / 2);
        c.rotate(-Math.PI / 2);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(yLabel, 0, 0);
        c.restore();
      }
    }

    /** Неперервна крива функції fn (полілінія з кроком ~2 px), обрізана областю графіка. */
    drawCurve(fn, style) {
      const s = Object.assign({ color: '#000', width: 2, dash: [], from: this.vp.xMin, to: this.vp.xMax }, style || {});
      this.clipPlot(c => {
        c.strokeStyle = s.color;
        c.lineWidth = s.width;
        c.setLineDash(s.dash);
        c.beginPath();
        const steps = Math.max(60, Math.round(this.plotW / 2));
        const yLimit = (this.vp.yMax - this.vp.yMin) * 50;
        let pen = false;
        for (let i = 0; i <= steps; i++) {
          const x = s.from + (s.to - s.from) * i / steps;
          const y = fn(x);
          if (!Number.isFinite(y) || Math.abs(y) > Math.abs(this.vp.yMax) + yLimit) { pen = false; continue; }
          const px = this.sx(x), py = this.sy(y);
          if (pen) c.lineTo(px, py); else { c.moveTo(px, py); pen = true; }
        }
        c.stroke();
        c.setLineDash([]);
      });
    }

    /** Маркери точок; highlight — індекс активного вузла (збільшений червоний маркер). */
    drawPoints(points, opts) {
      const o = Object.assign({ color: COLORS.points, r: this.compact ? 3.5 : 4.5, highlight: -1, highlightR: 9, hover: -1, dim: null }, opts || {});
      const c = this.ctx;
      points.forEach((p, i) => {
        const px = this.sx(p.x), py = this.sy(p.y);
        const dimmed = o.dim && o.dim(i);
        c.beginPath();
        c.arc(px, py, o.r, 0, Math.PI * 2);
        c.fillStyle = dimmed ? '#d1d5db' : o.color;
        c.fill();
        c.lineWidth = 1.5;
        c.strokeStyle = '#ffffff';
        c.stroke();
        if (i === o.hover) {
          c.beginPath(); c.arc(px, py, o.r + 4, 0, Math.PI * 2);
          c.strokeStyle = COLORS.interp; c.lineWidth = 2; c.stroke();
        }
      });
      if (o.highlight >= 0 && points[o.highlight]) {
        const p = points[o.highlight];
        const px = this.sx(p.x), py = this.sy(p.y);
        c.beginPath(); c.arc(px, py, o.highlightR, 0, Math.PI * 2);
        c.fillStyle = 'rgba(244, 63, 94, 0.25)'; c.fill();
        c.beginPath(); c.arc(px, py, 6, 0, Math.PI * 2);
        c.fillStyle = COLORS.active; c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
      }
    }

    /** Вектори залишків на головному графіку: відрізки від (x_i, ŷ_i) до (x_i, y_i). */
    drawResidualSegments(points, yHat, fractions) {
      this.clipPlot(c => {
        c.strokeStyle = COLORS.residual;
        c.lineWidth = 1.5;
        c.setLineDash([4, 3]);
        points.forEach((p, i) => {
          const f = fractions ? fractions[i] : 1;
          if (f <= 0) return;
          const y1 = yHat[i], y2 = yHat[i] + (p.y - yHat[i]) * f;
          c.beginPath(); c.moveTo(this.sx(p.x), this.sy(y1)); c.lineTo(this.sx(p.x), this.sy(y2)); c.stroke();
        });
        c.setLineDash([]);
      });
    }

    /** Діаграма залишків: штрихи від нуля до r_i, маркери, підписана нульова лінія. */
    drawStems(xs, rs, opts) {
      const o = Object.assign({ color: COLORS.residual, fractions: null, hover: -1 }, opts || {});
      const c = this.ctx;
      const y0 = this.sy(0);
      c.strokeStyle = '#111827';
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(this.margin.l, y0); c.lineTo(this.margin.l + this.plotW, y0); c.stroke();
      c.fillStyle = '#111827';
      c.font = 'bold 11px system-ui, sans-serif';
      c.textAlign = 'left'; c.textBaseline = 'bottom';
      c.fillText('r = 0', this.margin.l + 6, y0 - 3);
      xs.forEach((x, i) => {
        const f = o.fractions ? o.fractions[i] : 1;
        if (f <= 0) return;
        const r = rs[i] * f;
        const px = this.sx(x), py = this.sy(r);
        c.strokeStyle = o.color; c.lineWidth = 2;
        c.beginPath(); c.moveTo(px, y0); c.lineTo(px, py); c.stroke();
        c.beginPath(); c.arc(px, py, i === o.hover ? 6 : 4, 0, Math.PI * 2);
        c.fillStyle = o.color; c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.stroke();
      });
    }

    /** Заголовок у лівому верхньому куті (для малих графіків порівняння). */
    drawTitle(text, sub) {
      const c = this.ctx;
      c.font = 'bold 12px system-ui, sans-serif';
      c.fillStyle = '#111827'; c.textAlign = 'left'; c.textBaseline = 'top';
      c.fillText(text, this.margin.l + 8, this.margin.t + 6);
      if (sub) {
        c.font = '11px system-ui, sans-serif'; c.fillStyle = '#4b5563';
        c.fillText(sub, this.margin.l + 8, this.margin.t + 22);
      }
    }
  }

  global.PlotLib = { Plot, COLORS, computeViewport, lerpViewport, viewportClose, niceStep, fmt };
})(window);
