/**
 * animation.js — покрокові анімації на requestAnimationFrame.
 *  • 'lagrange': вузли додаються по одному; крива плавно морфується від полінома
 *    за k−1 вузлами до полінома за k вузлами; новий вузол виділяється.
 *  • 'lsm': коефіцієнти МНК плавно «виростають» від горизонтальної лінії y = ȳ
 *    до остаточних; потім по черзі з'являються відрізки залишків.
 * Сам рушій лише рахує стан кадру; малює main.js (через onFrame).
 */
(function (global) {
  'use strict';

  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  class Animator {
    constructor(onFrame, onEnd) {
      this.onFrame = onFrame;
      this.onEnd = onEnd;
      this.speed = 1;
      this.reset();
    }

    get active() { return this.type !== null; }

    reset() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
      this.type = null;
      this.state = null;
      this.paused = false;
      this.elapsed = 0;
      this.last = 0;
    }

    /** Анімація інтерполяції: points — вузли, factory(xs, ys) — побудова інтерполятора. */
    startLagrange(points, factory) {
      this.reset();
      const n = points.length;
      // Інтерполятори для перших k вузлів (k = 1..n) — рахуються один раз
      const polys = [];
      for (let k = 1; k <= n; k++) {
        const sub = points.slice(0, k);
        polys.push(factory(sub.map(p => p.x), sub.map(p => p.y)));
      }
      this.type = 'lagrange';
      this.data = { n, polys, stepMs: 900 };
      this._run();
    }

    /** Анімація МНК: fit — результат LSQ.fitLSM. */
    startLSM(points, fit) {
      this.reset();
      const mean = points.reduce((s, p) => s + p.y, 0) / points.length;
      const start = fit.coefU.map((_, i) => (i === 0 ? mean : 0));
      this.type = 'lsm';
      this.data = { n: points.length, fit, start, growMs: 1800, residMs: 220 };
      this._run();
    }

    pause() { if (this.active) this.paused = true; }
    resume() { if (this.active && this.paused) { this.paused = false; this.last = performance.now(); } }

    _run() {
      this.last = performance.now();
      const tick = now => {
        if (!this.active) return;
        const dt = Math.min(64, now - this.last);
        this.last = now;
        if (!this.paused) this.elapsed += dt * this.speed;
        const done = this._computeState();
        this.onFrame(this.state);
        if (done) { const t = this.type; this.type = null; this.raf = null; if (this.onEnd) this.onEnd(t); return; }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    }

    _computeState() {
      const d = this.data;
      if (this.type === 'lagrange') {
        // крок s: показано s+1 вузлів (s = 1..n-1), t — прогрес морфінгу
        const total = (d.n - 1) * d.stepMs;
        const e = Math.min(this.elapsed, total);
        const s = Math.min(d.n - 1, Math.floor(e / d.stepMs) + 1);
        const t = e >= total ? 1 : (e - (s - 1) * d.stepMs) / d.stepMs;
        const k = easeInOut(Math.min(1, t * 1.6));
        const prev = d.polys[s - 1], next = d.polys[s];
        this.state = {
          type: 'lagrange',
          visibleCount: s + 1,
          activeIndex: s,
          pulse: 1 - t,
          curve: x => (1 - k) * prev(x) + k * next(x),
          label: `Вузлів: ${s + 1} / ${d.n}`
        };
        return this.elapsed >= total + 400;
      }
      if (this.type === 'lsm') {
        const residTotal = d.n * d.residMs;
        const g = Math.min(1, this.elapsed / d.growMs);
        const k = easeInOut(g);
        const coef = d.start.map((c0, i) => c0 + (d.fit.coefU[i] - c0) * k);
        const toU = d.fit.toU;
        const curve = x => global.LSQ.horner(coef, toU(x));
        const re = Math.max(0, this.elapsed - d.growMs);
        const fractions = new Array(d.n).fill(0).map((_, i) => Math.max(0, Math.min(1, (re - i * d.residMs) / d.residMs)));
        this.state = {
          type: 'lsm',
          curve,
          growth: g,
          fractions: g < 1 ? null : fractions,
          label: g < 1 ? `Ріст полінома: ${Math.round(g * 100)}%` : `Залишки: ${fractions.filter(f => f >= 1).length} / ${d.n}`
        };
        return this.elapsed >= d.growMs + residTotal + 400;
      }
      return true;
    }
  }

  global.Anim = { Animator, easeInOut };
})(window);
