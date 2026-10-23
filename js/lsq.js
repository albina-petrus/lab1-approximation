/**
 * lsq.js — апроксимація методом найменших квадратів (МНК).
 * Ступінь моделі m = 1..4. Коефіцієнти оцінюються QR-розкладом Хаусхолдера
 * (нормальні рівняння XᵀX·a = Xᵀy НЕ використовуються).
 * Для стійкості x нормалізується до u ∈ [-1, 1].
 */
(function (global) {
  'use strict';

  /** Дизайн-матриця Вандермонда N×(m+1): рядок i = [1, u_i, u_i², …, u_i^m]. */
  function designMatrix(us, m) {
    return us.map(u => {
      const row = new Array(m + 1);
      let p = 1;
      for (let j = 0; j <= m; j++) { row[j] = p; p *= u; }
      return row;
    });
  }

  /**
   * QR-розклад відбиттями Хаусхолдера: A (N×K) → R (верхньотрикутна), d = Qᵀ·y.
   * H_j = I − 2·v·vᵀ, знак α обирається протилежним до R[j][j] (без втрати розрядів).
   */
  function householderQR(A, y) {
    const n = A.length, k = A[0].length;
    const R = A.map(r => r.slice());
    const d = y.slice();
    for (let j = 0; j < k; j++) {
      let norm = 0;
      for (let i = j; i < n; i++) norm += R[i][j] * R[i][j];
      norm = Math.sqrt(norm);
      if (norm < 1e-15) continue;
      const alpha = R[j][j] > 0 ? -norm : norm;
      const v = new Array(n - j);
      v[0] = R[j][j] - alpha;
      for (let i = j + 1; i < n; i++) v[i - j] = R[i][j];
      let vn = 0;
      for (let i = 0; i < v.length; i++) vn += v[i] * v[i];
      vn = Math.sqrt(vn);
      if (vn < 1e-15) continue;
      for (let i = 0; i < v.length; i++) v[i] /= vn;
      // R ← H·R (лише стовпці j..k-1)
      for (let c = j; c < k; c++) {
        let dot = 0;
        for (let i = j; i < n; i++) dot += v[i - j] * R[i][c];
        for (let i = j; i < n; i++) R[i][c] -= 2 * v[i - j] * dot;
      }
      // d ← H·d
      let dd = 0;
      for (let i = j; i < n; i++) dd += v[i - j] * d[i];
      for (let i = j; i < n; i++) d[i] -= 2 * v[i - j] * dd;
    }
    return { R, d };
  }

  /** Зворотна підстановка для R[0:k,0:k]·a = d[0:k]. */
  function backSubstitution(R, d, k) {
    const a = new Array(k).fill(0);
    for (let i = k - 1; i >= 0; i--) {
      let s = d[i];
      for (let j = i + 1; j < k; j++) s -= R[i][j] * a[j];
      a[i] = Math.abs(R[i][i]) < 1e-14 ? 0 : s / R[i][i];
    }
    return a;
  }

  /** Обчислення полінома зі коефіцієнтами c (за зростанням степенів) за Горнером. */
  function horner(c, t) {
    let r = 0;
    for (let i = c.length - 1; i >= 0; i--) r = r * t + c[i];
    return r;
  }

  /**
   * Перерахунок коефіцієнтів з базису u = (x − mid)/half у базис x
   * (для виведення рівняння y = b0 + b1·x + … у звіті та інтерфейсі).
   */
  function toXBasis(a, mid, half) {
    // u = p·x + q, де p = 1/half, q = −mid/half
    const p = 1 / half, q = -mid / half;
    let result = [0];
    let uPow = [1]; // поліном u^j у базисі x
    for (let j = 0; j < a.length; j++) {
      for (let i = 0; i < uPow.length; i++) {
        result[i] = (result[i] || 0) + a[j] * uPow[i];
      }
      // uPow ← uPow · (q + p·x)
      const next = new Array(uPow.length + 1).fill(0);
      for (let i = 0; i < uPow.length; i++) {
        next[i] += uPow[i] * q;
        next[i + 1] += uPow[i] * p;
      }
      uPow = next;
    }
    return result.slice(0, a.length);
  }

  /** Метрики якості: SSE, MSE, RMSE, max|r|, R². */
  function computeMetrics(ys, yHat) {
    const n = ys.length;
    const residuals = ys.map((y, i) => y - yHat[i]);
    const sse = residuals.reduce((s, r) => s + r * r, 0);
    const mean = ys.reduce((s, y) => s + y, 0) / n;
    const sst = ys.reduce((s, y) => s + (y - mean) * (y - mean), 0);
    return {
      residuals,
      sse,
      mse: sse / n,
      rmse: Math.sqrt(sse / n),
      maxAbs: Math.max(...residuals.map(Math.abs)),
      r2: sst < 1e-15 ? 1 : 1 - sse / sst
    };
  }

  /**
   * Повний розрахунок МНК ступеня m.
   * Повертає: коефіцієнти в базисі u (для анімації) і x (для звіту), функцію predict,
   * ŷ_i, залишки r_i і метрики.
   */
  function fitLSM(points, m) {
    const n = points.length;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const deg = Math.min(m, n - 1); // при n ≤ m ступінь обмежується
    const min = Math.min(...xs), max = Math.max(...xs);
    const mid = (min + max) / 2, half = (max - min) / 2 || 1;
    const toU = x => (x - mid) / half;
    const us = xs.map(toU);

    const X = designMatrix(us, deg);
    const { R, d } = householderQR(X, ys);
    const coefU = backSubstitution(R, d, deg + 1);
    const predict = x => horner(coefU, toU(x));
    const yHat = xs.map(predict);
    const metrics = computeMetrics(ys, yHat);

    return {
      m: deg,
      coefU,
      coefX: toXBasis(coefU, mid, half),
      toU,
      predict,
      yHat,
      residuals: metrics.residuals,
      metrics
    };
  }

  /** Рядок рівняння y = b0 + b1·x + … для відображення. */
  function equationString(coefX, digits) {
    const dgt = digits == null ? 4 : digits;
    const parts = [];
    coefX.forEach((c, i) => {
      if (Math.abs(c) < 1e-10) return;
      let v = Math.abs(c).toFixed(dgt).replace(/\.?0+$/, '');
      if (v === '0') return;
      if (i > 0 && v === '1') v = '';
      const pow = i === 0 ? '' : i === 1 ? 'x' : 'x' + ['', '', '²', '³', '⁴'][i];
      const term = (i > 0 && v !== '' ? v + '·' : v) + pow;
      if (!parts.length) parts.push((c < 0 ? '−' : '') + term);
      else parts.push((c < 0 ? '− ' : '+ ') + term);
    });
    return 'y = ' + (parts.join(' ') || '0');
  }

  global.LSQ = { designMatrix, householderQR, backSubstitution, horner, toXBasis, computeMetrics, fitLSM, equationString };
})(window);
