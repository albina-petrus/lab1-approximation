# Таблиця ідентифікаторів

| Назва | Тип | Модуль | Призначення |
|---|---|---|---|
| `DATASETS` | Object<number, Point[]> | data.js | Набори точок варіанта 22 (5, 9, 20) |
| `Point` | {x: number, y: number} | — | Вузол (експериментальна точка) |
| `getDataset(key)` | (key) → Point[] | data.js | Копія набору |
| `parsePoints(text)` | (string) → {ok, points \| error} | data.js | Парсинг і валідація ручного вводу |
| `addNoise(points, level, seed)` | → Point[] | data.js | Детермінований шум вимірювань |
| `lagrange(xs, ys, x)` | → number | lagrange.js | Класичний поліном Лагранжа в точці |
| `createLagrange(xs, ys)` | → (x) → number | lagrange.js | Барицентрична форма (O(n) на точку) |
| `dividedDifferences(xs, ys)` | → number[][] | lagrange.js | Таблиця поділених різниць |
| `newtonEval(xs, table, x)` | → number | lagrange.js | Поліном Ньютона (схема Горнера) |
| `designMatrix(us, m)` | → number[][] | lsq.js | Дизайн-матриця Вандермонда N×(m+1) |
| `householderQR(A, y)` | → {R, d} | lsq.js | QR-розклад відбиттями Хаусхолдера |
| `backSubstitution(R, d, k)` | → number[] | lsq.js | Розв'язання R·a = d |
| `fitLSM(points, m)` | → LSMResult | lsq.js | Повний розрахунок МНК: коефіцієнти, ŷ, r, метрики |
| `computeMetrics(ys, yHat)` | → Metrics | lsq.js | SSE, MSE, RMSE, max\|r\|, R² |
| `toXBasis(a, mid, half)` | → number[] | lsq.js | Перерахунок коефіцієнтів з u у x |
| `Plot` | class | plot.js | Полотно: перетворення координат, сітка, криві, точки, залишки |
| `computeViewport(points, fns)` | → Viewport | plot.js | Автомасштаб: межі осей з відступом |
| `lerpViewport(cur, target, k)` | → Viewport | plot.js | Плавне наближення меж (без «смикання» осей) |
| `niceStep(range, ticks)` | → number | plot.js | Крок сітки 1/2/5·10ᵏ |
| `Animator` | class | animation.js | Рушій анімацій на requestAnimationFrame |
| `startLagrange(points, factory)` | method | animation.js | Покрокове додавання вузлів |
| `startLSM(points, fit)` | method | animation.js | Ріст полінома МНК і поява залишків |
| `state` | Object | main.js | Поточний набір, режим, метод, ступінь m, вигляд |
| `model` | Object | main.js | Результати обчислень для поточного набору |
| `render(snap)` | function | main.js | Перемальовування основного графіка і залишків |
| `renderCompare()` | function | main.js | Шість графіків порівняння і зведена таблиця |
| `onMouseMove(ev)` | function | main.js | Підказка при наведенні |
