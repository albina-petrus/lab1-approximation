/**
 * lagrange.js — інтерполяція.
 *  • lagrange(xs, ys, x)        — класична формула p(x) = Σ y_k·L_k(x) (з нормалізацією x);
 *  • createLagrange(xs, ys)     — барицентрична форма (O(n) на точку) для швидкого малювання;
 *  • dividedDifferences(xs, ys) — таблиця поділених різниць Ньютона;
 *  • newtonEval(xs, table, x)   — поліном Ньютона за схемою Горнера.
 */
(function (global) {
  'use strict';

  /** Афінне відображення x → u ∈ [-1, 1] (покращує обумовленість при великих n). */
  function makeNormalizer(xs) {
    const min = Math.min(...xs);
    const max = Math.max(...xs);
    const half = (max - min) / 2 || 1;
    const mid = (max + min) / 2;
    return x => (x - mid) / half;
  }

  /**
   * Класичний поліном Лагранжа в точці x.
   * Добутки рахуються для нормалізованих u: множники (u − u_j)/(u_k − u_j) мають порядок 1,
   * тож на 20 вузлах не виникає переповнення.
   */
  function lagrange(xs, ys, x) {
    const toU = makeNormalizer(xs);
    const us = xs.map(toU);
    const u = toU(x);
    let sum = 0;
    for (let k = 0; k < xs.length; k++) {
      let L = 1;
      for (let j = 0; j < xs.length; j++) {
        if (j !== k) L *= (u - us[j]) / (us[k] - us[j]);
      }
      sum += ys[k] * L;
    }
    return sum;
  }

  /** Барицентричні ваги w_k = 1 / Π_{j≠k}(u_k − u_j). */
  function barycentricWeights(us) {
    return us.map((uk, k) => {
      let w = 1;
      for (let j = 0; j < us.length; j++) if (j !== k) w *= (uk - us[j]);
      return 1 / w;
    });
  }

  /**
   * Фабрика інтерполятора (барицентрична формула 2-го роду):
   * p(x) = Σ(w_k·y_k/(u−u_k)) / Σ(w_k/(u−u_k)). Математично той самий поліном Лагранжа.
   */
  function createLagrange(xs, ys) {
    if (xs.length === 1) return () => ys[0];
    const toU = makeNormalizer(xs);
    const us = xs.map(toU);
    const w = barycentricWeights(us);
    return function (x) {
      const u = toU(x);
      let num = 0, den = 0;
      for (let k = 0; k < us.length; k++) {
        const d = u - us[k];
        if (Math.abs(d) < 1e-14) return ys[k]; // точно у вузлі
        const t = w[k] / d;
        num += t * ys[k];
        den += t;
      }
      return num / den;
    };
  }

  /**
   * Таблиця поділених різниць: table[i][j] = f[x_i, …, x_{i+j}].
   * Коефіцієнти полінома Ньютона — перший рядок table[0][j].
   */
  function dividedDifferences(xs, ys) {
    const n = xs.length;
    const table = Array.from({ length: n }, () => new Array(n).fill(null));
    for (let i = 0; i < n; i++) table[i][0] = ys[i];
    for (let j = 1; j < n; j++) {
      for (let i = 0; i < n - j; i++) {
        table[i][j] = (table[i + 1][j - 1] - table[i][j - 1]) / (xs[i + j] - xs[i]);
      }
    }
    return table;
  }

  /** P(x) = a0 + a1(x−x0) + … за схемою Горнера, a_j = table[0][j]. */
  function newtonEval(xs, table, x) {
    const n = xs.length;
    let r = table[0][n - 1];
    for (let j = n - 2; j >= 0; j--) r = r * (x - xs[j]) + table[0][j];
    return r;
  }

  function createNewton(xs, ys) {
    const table = dividedDifferences(xs, ys);
    return x => newtonEval(xs, table, x);
  }

  global.Interp = { lagrange, createLagrange, dividedDifferences, newtonEval, createNewton };
})(window);
