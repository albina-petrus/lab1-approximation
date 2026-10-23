/**
 * main.js — контролер застосунку: стан, обробники подій, оркестрація обчислень і рендеру.
 */
(function () {
  'use strict';
  const { Plot, COLORS, computeViewport, lerpViewport, viewportClose, fmt } = window.PlotLib;

  // ---------- Стан ----------
  const state = {
    datasetKey: '5',          // '5' | '9' | '20' | 'custom'
    basePoints: Data.getDataset(5),
    noise: false,
    mode: 'all',              // 'interp' | 'lsm' | 'all'
    method: 'lagrange',       // 'lagrange' | 'newton'
    degree: 2,
    allDegrees: false,
    hidden: new Set(),        // приховані через легенду криві
    view: 'main',
    hoverIndex: -1
  };
  let model = null;           // результати обчислень для поточного набору
  let shownVp = null;         // межі, що зараз показані (плавно наближаються до цільових)
  let lastFrame = null;       // стан останнього кадру анімації
  let settleRaf = null;       // кадр плавного доведення масштабу після перемикань

  const $ = id => document.getElementById(id);
  const mainPlot = new Plot($('mainCanvas'));
  const residPlot = new Plot($('residCanvas'), { margin: { b: 30 } });
  const animator = new Anim.Animator(onAnimFrame, onAnimEnd);

  // ---------- Обчислення ----------
  function currentPoints() {
    return state.noise ? Data.addNoise(state.basePoints, 0.02, 22) : state.basePoints;
  }

  function interpFactory(method) {
    return method === 'newton' ? Interp.createNewton : Interp.createLagrange;
  }

  function computeModel(points, method) {
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const interp = interpFactory(method)(xs, ys);
    const fits = {};
    for (let m = 1; m <= 4; m++) if (points.length > m) fits[m] = LSQ.fitLSM(points, m);
    const interpMetrics = LSQ.computeMetrics(ys, xs.map(interp));
    return { points, xs, ys, interp, fits, interpMetrics, table: Interp.dividedDifferences(xs, ys) };
  }

  function recompute() {
    model = computeModel(currentPoints(), state.method);
    if (!model.fits[state.degree]) state.degree = Math.max(...Object.keys(model.fits).map(Number));
    syncButtons();
    renderTables();
    renderLegend();
    render(true);
    if (state.view === 'compare') renderCompare();
  }

  // ---------- Які криві видимі ----------
  function visibleCurves() {
    const list = [];
    if (state.mode !== 'lsm') {
      list.push({ id: 'interp', fn: model.interp, color: COLORS.interp, width: 2.5,
        name: state.method === 'newton' ? 'Інтерполяція (Ньютон)' : 'Інтерполяція (Лагранж)' });
    }
    if (state.mode !== 'interp') {
      const degrees = state.allDegrees ? Object.keys(model.fits).map(Number) : [state.degree];
      degrees.forEach(m => {
        list.push({ id: 'lsm' + m, fn: model.fits[m].predict, color: COLORS.lsm[m], width: m === state.degree ? 2.5 : 1.8,
          dash: state.mode === 'all' ? [8, 5] : [], name: `МНК, m = ${m}` });
      });
    }
    return list.filter(c => !state.hidden.has(c.id));
  }

  /** Залишки для діаграми: у режимі «Інтерполяція» — інтерполяційні (≈0), інакше — МНК ступеня m. */
  function residualSource() {
    if (state.mode === 'interp') return { rs: model.interpMetrics.residuals, label: 'інтерполяція (у вузлах r = 0)', color: COLORS.interp };
    const f = model.fits[state.degree];
    return { rs: f.residuals, yHat: f.yHat, label: `МНК, m = ${f.m}`, color: COLORS.residual };
  }

  // ---------- Рендер основного графіка ----------
  function render(snap) {
    if (!model) return;
    const pts = model.points;
    const frame = animator.active ? lastFrame : null;

    // Криві, що малюються в цьому кадрі
    let curves = visibleCurves();
    let pointOpts = { hover: state.hoverIndex };
    let residFractions = null, segFractions = null, showSegments = state.mode !== 'interp';

    if (frame && frame.type === 'lagrange') {
      curves = [{ id: 'anim', fn: frame.curve, color: COLORS.interp, width: 2.8 }];
      pointOpts = { highlight: frame.activeIndex, highlightR: 8 + 10 * frame.pulse, dim: i => i >= frame.visibleCount };
      showSegments = false;
    } else if (frame && frame.type === 'lsm') {
      curves = [{ id: 'anim', fn: frame.curve, color: COLORS.lsm[state.degree], width: 2.8 }];
      segFractions = frame.fractions || new Array(pts.length).fill(0);
      residFractions = segFractions;
      showSegments = true;
    }

    // Автомасштаб: цільові межі з точок і видимих кривих; під час анімації — плавне наближення
    const target = computeViewport(pts, curves.map(c => c.fn));
    shownVp = (snap || !shownVp) ? target : lerpViewport(shownVp, target, 0.18);
    mainPlot.setViewport(shownVp);
    $('vpBadge').textContent = `X: [${fmt(shownVp.xMin)}; ${fmt(shownVp.xMax)}]  Y: [${fmt(shownVp.yMin)}; ${fmt(shownVp.yMax)}]`;

    mainPlot.clear();
    mainPlot.drawExtrapolationZones(model.xs[0], model.xs[model.xs.length - 1]);
    mainPlot.drawGrid('x', 'y');
    curves.forEach(c => mainPlot.drawCurve(c.fn, { color: c.color, width: c.width, dash: c.dash || [] }));
    const rsrc = residualSource();
    if (showSegments && rsrc.yHat) {
      const yHat = frame && frame.type === 'lsm' ? pts.map(p => frame.curve(p.x)) : rsrc.yHat;
      mainPlot.drawResidualSegments(pts, yHat, segFractions);
    }
    mainPlot.drawPoints(pts, pointOpts);

    // Діаграма залишків (вісь X синхронізована з головним графіком)
    let rs = rsrc.rs;
    if (frame && frame.type === 'lsm') rs = pts.map(p => p.y - frame.curve(p.x));
    if (frame && frame.type === 'lagrange') rs = pts.map((p, i) => (i < frame.visibleCount ? p.y - frame.curve(p.x) : 0));
    const rMax = Math.max(...rs.map(Math.abs));
    const rLim = rMax < 1e-9 ? 1 : rMax * 1.3;
    residPlot.setViewport({ xMin: shownVp.xMin, xMax: shownVp.xMax, yMin: -rLim, yMax: rLim });
    residPlot.clear();
    residPlot.drawGrid('x', 'r');
    residPlot.drawStems(model.xs, rs, { color: rsrc.color, fractions: residFractions, hover: state.hoverIndex });
    $('residBadge').textContent = `${rsrc.label}; max|r| = ${fmt(rMax)}`;

    // Анімація ще не дійшла до цільового масштабу — домальовуємо
    if (!animator.active && !viewportClose(shownVp, target) && !settleRaf) {
      settleRaf = requestAnimationFrame(() => { settleRaf = null; render(false); });
    }
  }

  // ---------- Легенда ----------
  function renderLegend() {
    const items = [{ id: 'points', name: 'Експериментальні точки', html: `<span class="swatch dot" style="background:${COLORS.points}"></span>` }];
    items.push({ id: 'interp', name: state.method === 'newton' ? 'Інтерполяція (Ньютон)' : 'Інтерполяція (Лагранж)', html: `<span class="swatch" style="border-color:${COLORS.interp}"></span>` });
    Object.keys(model.fits).forEach(m => items.push({ id: 'lsm' + m, name: `МНК, m = ${m}`, html: `<span class="swatch ${state.mode === 'all' ? 'dash' : ''}" style="border-color:${COLORS.lsm[m]}"></span>` }));
    items.push({ id: 'resid', name: 'Залишки rᵢ', html: `<span class="swatch dash" style="border-color:${COLORS.residual}"></span>` });
    items.push({ id: 'extrap', name: 'Зона екстраполяції', html: `<span class="swatch dot" style="background:#fde68a;border-radius:2px"></span>` });

    const visibleIds = new Set(['points', 'resid', 'extrap']);
    if (state.mode !== 'lsm') visibleIds.add('interp');
    if (state.mode !== 'interp') (state.allDegrees ? Object.keys(model.fits) : [state.degree]).forEach(m => visibleIds.add('lsm' + m));

    $('legend').innerHTML = items.filter(i => visibleIds.has(i.id)).map(i => {
      const toggle = i.id === 'interp' || i.id.startsWith('lsm');
      return toggle
        ? `<label><input type="checkbox" data-curve="${i.id}" ${state.hidden.has(i.id) ? '' : 'checked'}>${i.html}${i.name}</label>`
        : `<label>${i.html}${i.name}</label>`;
    }).join('');
  }

  // ---------- Таблиці ----------
  function renderTables() {
    const rows = [];
    rows.push(`<tr><th>Модель</th><th>Рівняння / ступінь</th><th>SSE</th><th>RMSE</th><th>max|r|</th><th>R²</th></tr>`);
    const im = model.interpMetrics;
    rows.push(`<tr><td>Інтерполяція</td><td>поліном ступеня ${model.points.length - 1}</td><td>${fmt(im.sse)}</td><td>${fmt(im.rmse)}</td><td>${fmt(im.maxAbs)}</td><td>${im.r2.toFixed(6)}</td></tr>`);
    Object.values(model.fits).forEach(f => {
      const mt = f.metrics;
      rows.push(`<tr class="${f.m === state.degree ? 'sel' : ''}"><td>МНК, m = ${f.m}</td><td>${LSQ.equationString(f.coefX)}</td><td>${fmt(mt.sse)}</td><td>${fmt(mt.rmse)}</td><td>${fmt(mt.maxAbs)}</td><td>${mt.r2.toFixed(6)}</td></tr>`);
    });
    $('metricsTable').innerHTML = rows.join('');

    // Таблиця поділених різниць
    const n = model.xs.length, T = model.table;
    let html = '<tr><th>i</th><th>xᵢ</th><th>f[xᵢ]</th>';
    for (let j = 1; j < n; j++) html += `<th>${j}-го пор.</th>`;
    html += '</tr>';
    for (let i = 0; i < n; i++) {
      html += `<tr><td>${i}</td><td>${fmt(model.xs[i])}</td>`;
      for (let j = 0; j < n; j++) html += `<td>${T[i][j] === null ? '' : fmt(T[i][j])}</td>`;
      html += '</tr>';
    }
    $('newtonTable').innerHTML = html;
  }

  // ---------- Порівняння: 6 графіків ----------
  function renderCompare() {
    const cells = document.querySelectorAll('.compare-grid canvas');
    const summary = [];
    const m = state.degree;
    cells.forEach(cv => {
      const key = cv.dataset.set, kind = cv.dataset.kind;
      let pts = Data.getDataset(key);
      if (state.noise) pts = Data.addNoise(pts, 0.02, 22);
      const md = computeModel(pts, state.method);
      const plot = cv._plot || (cv._plot = new Plot(cv, { compact: true, margin: { l: 46, b: 30 } }));
      plot.resize();
      const deg = Math.min(m, pts.length - 1);
      const fit = md.fits[deg];
      const fn = kind === 'interp' ? md.interp : fit.predict;
      plot.setViewport(computeViewport(pts, [fn]));
      plot.clear();
      plot.drawExtrapolationZones(md.xs[0], md.xs[md.xs.length - 1]);
      plot.drawGrid('x', 'y');
      plot.drawCurve(fn, { color: kind === 'interp' ? COLORS.interp : COLORS.lsm[deg], width: 2.2 });
      if (kind === 'lsm') plot.drawResidualSegments(pts, fit.yHat);
      plot.drawPoints(pts);
      const label = Data.DATASET_LABELS[key];
      if (kind === 'interp') {
        plot.drawTitle(`${state.method === 'newton' ? 'Ньютон' : 'Лагранж'} · ${label}`, `ступінь ${pts.length - 1}`);
        summary.push({ key, kind: 'Інтерполяція', mt: md.interpMetrics, eq: `ступінь ${pts.length - 1}` });
      } else {
        plot.drawTitle(`МНК m = ${deg} · ${label}`, `RMSE = ${fmt(fit.metrics.rmse)}, R² = ${fit.metrics.r2.toFixed(4)}`);
        for (let d = 1; d <= 4; d++) if (md.fits[d]) summary.push({ key, kind: `МНК, m = ${d}`, mt: md.fits[d].metrics, eq: LSQ.equationString(md.fits[d].coefX) });
      }
    });
    summary.sort((a, b) => Number(a.key) - Number(b.key));
    $('compareTable').innerHTML = '<tr><th>Набір</th><th>Модель</th><th>Рівняння</th><th>SSE</th><th>RMSE</th><th>max|r|</th><th>R²</th></tr>' +
      summary.map(s => `<tr><td>${Data.DATASET_LABELS[s.key]}</td><td>${s.kind}</td><td>${s.eq}</td><td>${fmt(s.mt.sse)}</td><td>${fmt(s.mt.rmse)}</td><td>${fmt(s.mt.maxAbs)}</td><td>${s.mt.r2.toFixed(6)}</td></tr>`).join('');
    $('compareNote').textContent = `Верхній ряд — інтерполяція, нижній — МНК (m = ${m})${state.noise ? ', з шумом ±2%' : ''}`;
  }

  // ---------- Анімація ----------
  function onAnimFrame(frame) {
    lastFrame = frame;
    $('animStatus').textContent = frame.label;
    render(false);
  }
  function onAnimEnd() {
    lastFrame = null;
    $('animStatus').textContent = 'Анімацію завершено';
    setAnimButtons(false);
    render(false);
  }
  function setAnimButtons(running) {
    $('animPause').disabled = !running;
    $('animReset').disabled = !running;
    $('animPause').textContent = '⏸ Пауза';
  }

  // ---------- Підказки при наведенні ----------
  function onMouseMove(ev) {
    if (!model) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const tip = $('tooltip');
    if (mx < mainPlot.margin.l || mx > mainPlot.margin.l + mainPlot.plotW || my < mainPlot.margin.t || my > mainPlot.margin.t + mainPlot.plotH) {
      tip.classList.add('hidden');
      if (state.hoverIndex !== -1) { state.hoverIndex = -1; if (!animator.active) render(true); }
      return;
    }
    // найближча точка в межах 14 px
    let best = -1, bestD = 14;
    model.points.forEach((p, i) => {
      const d = Math.hypot(mainPlot.sx(p.x) - mx, mainPlot.sy(p.y) - my);
      if (d < bestD) { bestD = d; best = i; }
    });
    let html;
    const fit = model.fits[state.degree];
    if (best >= 0) {
      const p = model.points[best];
      html = `<b>Вузол ${best + 1}</b>: x = ${fmt(p.x)}, y = ${fmt(p.y)}<br>` +
        `P(x) = ${fmt(model.interp(p.x))}, r<sub>інт</sub> = ${fmt(model.interpMetrics.residuals[best])}<br>` +
        `ŷ (МНК m=${fit.m}) = ${fmt(fit.yHat[best])}, <b>r = ${fmt(fit.residuals[best])}</b>`;
    } else {
      const x = mainPlot.invX(mx);
      const zone = x < model.xs[0] || x > model.xs[model.xs.length - 1] ? ' <i>(екстраполяція)</i>' : '';
      html = `x = ${fmt(x)}, y = ${fmt(mainPlot.invY(my))}${zone}<br>` +
        visibleCurves().map(c => `${c.name}: ${fmt(c.fn(x))}`).join('<br>');
    }
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(mx + 14, rect.width - tw - 4) + 'px';
    tip.style.top = Math.max(4, my - th - 10) + 'px';
    if (best !== state.hoverIndex) { state.hoverIndex = best; if (!animator.active) render(true); }
  }

  // ---------- Синхронізація кнопок ----------
  function setActive(containerId, attr, value) {
    document.querySelectorAll(`#${containerId} button`).forEach(b => b.classList.toggle('active', b.dataset[attr] === String(value)));
  }
  function syncButtons() {
    setActive('datasetSwitch', 'set', state.datasetKey);
    setActive('modeSwitch', 'mode', state.mode);
    setActive('methodSwitch', 'method', state.method);
    setActive('degreeSwitch', 'm', state.degree);
    document.querySelectorAll('#degreeSwitch button').forEach(b => { b.disabled = !model.fits[b.dataset.m]; });
  }

  function loadDataset(key) {
    animator.reset(); lastFrame = null; setAnimButtons(false);
    state.datasetKey = String(key);
    state.basePoints = Data.getDataset(key);
    $('pointsInput').value = Data.pointsToText(state.basePoints);
    $('inputError').textContent = '';
    recompute();
  }

  // ---------- Обробники подій ----------
  $('datasetSwitch').addEventListener('click', e => { const b = e.target.closest('button'); if (b) loadDataset(b.dataset.set); });
  $('applyPoints').addEventListener('click', () => {
    const res = Data.parsePoints($('pointsInput').value);
    if (!res.ok) { $('inputError').textContent = res.error; return; }
    $('inputError').textContent = `Прийнято ${res.points.length} точок`;
    animator.reset(); lastFrame = null; setAnimButtons(false);
    state.datasetKey = 'custom';
    state.basePoints = res.points;
    recompute();
  });
  $('noiseToggle').addEventListener('change', e => { state.noise = e.target.checked; animator.reset(); lastFrame = null; setAnimButtons(false); recompute(); });
  $('modeSwitch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.mode = b.dataset.mode; syncButtons(); renderLegend(); render(false); });
  $('methodSwitch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.method = b.dataset.method; recompute(); });
  $('degreeSwitch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; state.degree = Number(b.dataset.m); syncButtons(); renderTables(); renderLegend(); render(false); if (state.view === 'compare') renderCompare(); });
  $('allDegrees').addEventListener('change', e => { state.allDegrees = e.target.checked; renderLegend(); render(false); });
  $('legend').addEventListener('change', e => {
    const id = e.target.dataset.curve; if (!id) return;
    if (e.target.checked) state.hidden.delete(id); else state.hidden.add(id);
    render(false);
  });

  $('animInterp').addEventListener('click', () => {
    if (state.view !== 'main') switchView('main');
    animator.startLagrange(model.points, interpFactory(state.method));
    setAnimButtons(true);
  });
  $('animLsm').addEventListener('click', () => {
    if (state.view !== 'main') switchView('main');
    animator.startLSM(model.points, model.fits[state.degree]);
    setAnimButtons(true);
  });
  $('animPause').addEventListener('click', () => {
    if (animator.paused) { animator.resume(); $('animPause').textContent = '⏸ Пауза'; }
    else { animator.pause(); $('animPause').textContent = '▶ Продовжити'; $('animStatus').textContent += ' (пауза)'; }
  });
  $('animReset').addEventListener('click', () => {
    animator.reset(); lastFrame = null; setAnimButtons(false);
    $('animStatus').textContent = 'Анімацію скинуто';
    render(false);
  });
  $('speed').addEventListener('input', e => { animator.speed = Number(e.target.value); $('speedVal').textContent = Number(e.target.value).toFixed(2).replace(/0$/, '') + '×'; });

  const mainCanvas = $('mainCanvas');
  mainCanvas.addEventListener('mousemove', onMouseMove);
  mainCanvas.addEventListener('mouseleave', () => { $('tooltip').classList.add('hidden'); state.hoverIndex = -1; if (!animator.active) render(true); });

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    $('viewMain').classList.toggle('hidden', view !== 'main');
    $('viewCompare').classList.toggle('hidden', view !== 'compare');
    if (view === 'main') { mainPlot.resize(); residPlot.resize(); render(true); }
    else renderCompare();
  }
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchView(t.dataset.view)));

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view === 'main') { mainPlot.resize(); residPlot.resize(); render(true); }
      else renderCompare();
    }, 80);
  });

  // Доступ для автоматичних скріншотів / налагодження
  window.App = { pointToScreen: i => ({ x: mainPlot.sx(model.points[i].x), y: mainPlot.sy(model.points[i].y) }), state, switchView, loadDataset, get model() { return model; }, animator, render, recompute };

  loadDataset(5);
})();
