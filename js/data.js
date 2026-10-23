/**
 * data.js — модуль даних.
 * Набори точок варіанта №22 (5, 9 і 20 точок з файлу «Варіанти до ЛР № 1.xlsx»),
 * парсер і валідатор ручного вводу, генератор «шуму вимірювань».
 */
(function (global) {
  'use strict';

  /** Набори точок варіанта №22. Ключ — кількість точок. */
  const DATASETS = {
    5: [
      { x: 1, y: 1.0 }, { x: 2, y: 4.0 }, { x: 3, y: 9.0 }, { x: 4, y: 16.0 }, { x: 5, y: 25.0 }
    ],
    // У файлі варіантів на вкладці «10 точок» для варіанта 22 наведено 9 точок
    9: [
      { x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 4 }, { x: 3, y: 7 }, { x: 4, y: 11 },
      { x: 5, y: 16 }, { x: 6, y: 22 }, { x: 7, y: 29 }, { x: 8, y: 37 }
    ],
    20: [
      { x: 0, y: 1.5 }, { x: 0.5, y: 1.8 }, { x: 1, y: 2.5 }, { x: 1.5, y: 3.6 }, { x: 2, y: 5.1 },
      { x: 2.5, y: 7.0 }, { x: 3, y: 9.3 }, { x: 3.5, y: 12.0 }, { x: 4, y: 15.1 }, { x: 4.5, y: 18.6 },
      { x: 5, y: 22.5 }, { x: 5.5, y: 26.8 }, { x: 6, y: 31.5 }, { x: 6.5, y: 36.6 }, { x: 7, y: 42.1 },
      { x: 7.5, y: 48.0 }, { x: 8, y: 54.3 }, { x: 8.5, y: 61.0 }, { x: 9, y: 68.1 }, { x: 9.5, y: 75.6 }
    ]
  };

  /** Підписи наборів для інтерфейсу. */
  const DATASET_LABELS = { 5: '5 точок', 9: '10 точок (9)', 20: '20 точок' };

  /** Копія набору (щоб випадково не змінити оригінал). */
  function getDataset(key) {
    return DATASETS[key].map(p => ({ x: p.x, y: p.y }));
  }

  /** Точки → текст для textarea: кожна пара з нового рядка. */
  function pointsToText(points) {
    return points.map(p => `${p.x}; ${p.y}`).join('\n');
  }

  /**
   * Парсинг і валідація тексту з точками.
   * Пара в рядку: «x; y», «x y» або «x, y» (для «x, y» десяткова частина — через крапку).
   * Повертає { ok, points } або { ok:false, error }.
   */
  function parsePoints(text) {
    const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (lines.length < 2) return { ok: false, error: 'Потрібно щонайменше 2 точки.' };

    const points = [];
    const seen = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/^\(|\)$/g, '');
      let parts;
      if (line.includes(';')) parts = line.split(';');
      else if (/\s/.test(line.trim())) parts = line.trim().split(/\s+/);
      else parts = line.split(',');
      parts = parts.map(s => s.trim().replace(',', '.')).filter(Boolean);
      if (parts.length !== 2) {
        return { ok: false, error: `Рядок ${i + 1}: очікується пара «x; y», отримано «${lines[i]}».` };
      }
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { ok: false, error: `Рядок ${i + 1}: x і y мають бути числами.` };
      }
      if (seen.has(x)) {
        return { ok: false, error: `Рядок ${i + 1}: x = ${x} повторюється — вузли мають бути різними.` };
      }
      seen.add(x);
      points.push({ x, y });
    }
    if (points.length > 30) return { ok: false, error: 'Максимум 30 точок.' };
    points.sort((a, b) => a.x - b.x);
    return { ok: true, points };
  }

  /**
   * Детермінований «шум вимірювань»: y·(1 + level·ξ), ξ ∈ [-1, 1].
   * Генератор mulberry32 з фіксованим зерном — результат однаковий при кожному запуску.
   */
  function addNoise(points, level, seed) {
    let a = (seed || 22) >>> 0;
    const rnd = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const span = Math.max(...points.map(p => Math.abs(p.y))) || 1;
    return points.map(p => ({ x: p.x, y: +(p.y + level * span * (2 * rnd() - 1)).toFixed(3) }));
  }

  global.Data = { DATASETS, DATASET_LABELS, getDataset, pointsToText, parsePoints, addNoise };
})(window);
