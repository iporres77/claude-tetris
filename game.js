'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - azul pálido
  '#ffb74d', // L - orange
  '#b0bec5', // N - tuerca (gris metálico)
];

// Pieza de reto: anillo 3×3 con hueco central
const NUT = 8;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca
];

// Paleta más saturada para el tema claro (mismo orden que COLORS)
const COLORS_LIGHT = [
  null,
  '#00acc1', // I
  '#f9a825', // O
  '#8e24aa', // T
  '#43a047', // S
  '#e53935', // Z
  '#1e88e5', // J
  '#fb8c00', // L
  '#607d8b', // N
];

const THEME_KEY = 'tetris-theme';
let theme = 'dark';
let palette = COLORS;
let gridColor = '#22222e';
let highlightColor = 'rgba(255,255,255,0.12)';
let ghostAlpha = 0.2;

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const holdSection = document.getElementById('hold-section');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeBtn = document.getElementById('theme-btn');

let board, current, next, hold, holdUsed, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  return createPiece(Math.floor(Math.random() * (PIECES.length - 1)) + 1);
}

function createPiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  trackCombo(cleared);
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  setHoldUsed(false);
  spawn();
}

// Guarda la pieza actual; si ya había una, la intercambia (una vez por pieza)
function holdPiece() {
  if (holdUsed) return;
  const type = current.type;
  if (hold) {
    current = createPiece(hold);
    if (collide(current.shape, current.x, current.y)) endGame();
  } else {
    spawn();
  }
  hold = type;
  dropAccum = 0;
  setHoldUsed(true);
  drawHold();
}

function setHoldUsed(used) {
  holdUsed = used;
  holdSection.classList.toggle('locked', used);
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = palette[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = highlightColor;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

// Aro de la tuerca sobre su celda central vacía
function drawNutHole(context, x, y, size, alpha) {
  context.globalAlpha = alpha ?? 1;
  context.strokeStyle = palette[NUT];
  context.lineWidth = 3;
  context.beginPath();
  context.arc(x * size + size / 2, y * size + size / 2, size * 0.3, 0, Math.PI * 2);
  context.stroke();
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, ghostAlpha);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  if (current.type === NUT) {
    drawNutHole(ctx, current.x + 1, gy + 1, BLOCK, ghostAlpha);
    drawNutHole(ctx, current.x + 1, current.y + 1, BLOCK);
  }
}

// Dibuja una pieza centrada en un canvas de 4×4 celdas (next y hold)
function drawPreview(context, type) {
  const NB = 30;
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  if (!type) return;
  const shape = PIECES[type];
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(context, offX + c, offY + r, shape[r][c], NB);
  if (type === NUT) drawNutHole(context, offX + 1, offY + 1, NB);
}

function drawNext() {
  drawPreview(nextCtx, next.type);
}

function drawHold() {
  drawPreview(holdCtx, hold);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  onRecordsGameOver();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  // endGame() no puede cancelar el frame en curso: hay que cortar aquí
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  onRecordsGameStart(); // antes del reset: cierra los récords de la partida anterior
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  hold = 0;
  setHoldUsed(false);
  drawHold();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // Escribiendo el nombre del récord o aún en la pantalla de inicio
  if (isTypingTarget(e.target) || !started) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      holdPiece();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

function setTheme(newTheme, save = true) {
  theme = newTheme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  const css = getComputedStyle(document.documentElement);
  palette = theme === 'light' ? COLORS_LIGHT : COLORS;
  gridColor = css.getPropertyValue('--grid').trim();
  highlightColor = css.getPropertyValue('--highlight').trim();
  ghostAlpha = parseFloat(css.getPropertyValue('--ghost-alpha')) || 0.2;
  themeBtn.textContent = theme === 'light' ? 'Modo oscuro' : 'Modo claro';
  themeBtn.setAttribute('aria-pressed', String(theme === 'light'));
  if (save) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (_) { /* sin almacenamiento */ }
  }
  // La vista previa no se redibuja por frame (p. ej. en pausa o game over)
  if (next) { drawNext(); drawHold(); }
}

themeBtn.addEventListener('click', () => {
  setTheme(theme === 'light' ? 'dark' : 'light');
  themeBtn.blur(); // evita que Space/flechas activen el botón
});

// Space en el botón no debe activarlo (Space es caída)
themeBtn.addEventListener('keyup', e => {
  if (e.code === 'Space') e.preventDefault();
});

let savedTheme = null;
try { savedTheme = localStorage.getItem(THEME_KEY); } catch (_) { /* ignorar */ }
setTheme(savedTheme === 'light' ? 'light' : 'dark', false);

// ==== Tabla de récords local =================================================
// localStorage['tetris-records'] = { top: [{ name, score, lines, level, date }],
//                                    bestCombo, maxLines }
// Combo = piezas consecutivas que eliminan al menos una línea.

const RECORDS_KEY = 'tetris-records';
const PLAYER_KEY = 'tetris-player';
const MAX_RECORDS = 5;
const NAME_MAX = 12;
const DEFAULT_NAME = 'Jugador';

const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const recordsStartTable = document.getElementById('records-start-table');
const recordsStartStats = document.getElementById('records-start-stats');
const recordsGameover = document.getElementById('records-gameover');
const recordsGameoverTable = document.getElementById('records-gameover-table');
const recordsGameoverStats = document.getElementById('records-gameover-stats');
const recordMsg = document.getElementById('record-msg');
const recordForm = document.getElementById('record-form');
const recordName = document.getElementById('record-name');
const clearStartBtn = document.getElementById('records-clear-start');
const clearGameoverBtn = document.getElementById('records-clear-gameover');

let started = false;      // false mientras se muestra la pantalla de inicio
let combo = 0;            // combo en curso
let maxCombo = 0;         // mejor combo de la partida actual
let pendingRecord = null; // puntuación de la partida pendiente de nombre
let highlightIdx = -1;    // fila a resaltar en el overlay de game over

function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function toCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cleanName(v) {
  // Sin caracteres de control y recortado a NAME_MAX
  const name = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX).trim();
  return name || DEFAULT_NAME;
}

function emptyRecords() {
  return { top: [], bestCombo: 0, maxLines: 0 };
}

function loadRecords() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(RECORDS_KEY)); } catch (_) { /* datos corruptos o sin almacenamiento */ }
  if (!data || typeof data !== 'object') return emptyRecords();
  const top = (Array.isArray(data.top) ? data.top : [])
    .filter(r => r && typeof r === 'object' && toCount(r.score) > 0)
    .map(r => ({
      name: cleanName(r.name),
      score: toCount(r.score),
      lines: toCount(r.lines),
      level: Math.max(1, toCount(r.level)),
      date: typeof r.date === 'string' ? r.date.slice(0, 10) : '',
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECORDS);
  return { top, bestCombo: toCount(data.bestCombo), maxLines: toCount(data.maxLines) };
}

function saveRecords(rec) {
  try { localStorage.setItem(RECORDS_KEY, JSON.stringify(rec)); } catch (_) { /* sin almacenamiento */ }
}

function qualifies(rec, s) {
  return s > 0 && (rec.top.length < MAX_RECORDS || s > rec.top[rec.top.length - 1].score);
}

// Construye la tabla con textContent: los nombres son datos del usuario
function renderRecords(container, statsEl, rec, highlight) {
  container.replaceChildren();
  if (!rec.top.length) {
    const p = document.createElement('p');
    p.className = 'records-empty';
    p.textContent = 'Aún no hay récords';
    container.appendChild(p);
  } else {
    const table = document.createElement('table');
    table.className = 'records-table';
    const head = table.createTHead().insertRow();
    for (const h of ['#', 'NOMBRE', 'PUNTOS', 'LÍN', 'NIV']) {
      const th = document.createElement('th');
      th.textContent = h;
      head.appendChild(th);
    }
    const body = table.createTBody();
    rec.top.forEach((r, i) => {
      const tr = body.insertRow();
      if (i === highlight) tr.className = 'highlight';
      if (r.date) tr.title = r.date;
      [i + 1, r.name, r.score.toLocaleString(), r.lines, r.level].forEach((v, c) => {
        const td = tr.insertCell();
        td.textContent = String(v);
        if (c === 1) td.className = 'rec-name';
      });
    });
    container.appendChild(table);
  }
  statsEl.textContent = `Mejor combo: ${rec.bestCombo} · Máx. líneas: ${rec.maxLines}`;
}

function renderAllRecords(rec = loadRecords()) {
  renderRecords(recordsStartTable, recordsStartStats, rec, -1);
  renderRecords(recordsGameoverTable, recordsGameoverStats, rec, highlightIdx);
}

function trackCombo(cleared) {
  combo = cleared ? combo + 1 : 0;
  if (combo > maxCombo) maxCombo = combo;
}

// Guarda el mejor combo y las líneas máximas de la partida actual
function updateStats(rec) {
  rec.bestCombo = Math.max(rec.bestCombo, maxCombo);
  rec.maxLines = Math.max(rec.maxLines, lines);
  saveRecords(rec);
}

function onRecordsGameStart() {
  // Reiniciar sin pulsar Guardar no pierde el récord
  if (pendingRecord) saveRecord();
  // Partida abandonada (Reiniciar desde la pausa): conservar sus estadísticas
  else if (started && !gameOver) updateStats(loadRecords());
  started = true;
  combo = 0;
  maxCombo = 0;
  pendingRecord = null;
  highlightIdx = -1;
  startScreen.classList.add('hidden');
  recordsGameover.classList.add('hidden');
  clearGameoverBtn.classList.add('hidden');
}

function onRecordsGameOver() {
  const rec = loadRecords();
  updateStats(rec);

  highlightIdx = -1;
  overlayScore.textContent += ` · Combo máx.: ${maxCombo}`;
  if (qualifies(rec, score)) {
    pendingRecord = { score, lines, level, date: new Date().toISOString().slice(0, 10) };
    recordMsg.textContent = '¡Entras en el top 5!';
    let lastName = '';
    try { lastName = localStorage.getItem(PLAYER_KEY) || ''; } catch (_) { /* ignorar */ }
    recordName.value = cleanName(lastName);
    recordForm.classList.remove('hidden');
    recordsGameoverTable.classList.add('hidden');
    // Diferido: que la tecla que acabó la partida no se escriba en el campo
    setTimeout(() => {
      if (!gameOver || !pendingRecord) return;
      recordName.focus();
      const end = recordName.value.length;
      recordName.setSelectionRange(end, end);
    }, 0);
  } else {
    pendingRecord = null;
    recordMsg.textContent = '';
    recordForm.classList.add('hidden');
    recordsGameoverTable.classList.remove('hidden');
  }
  recordsGameover.classList.remove('hidden');
  clearGameoverBtn.classList.remove('hidden');
  renderAllRecords(rec);
}

function saveRecord() {
  if (!pendingRecord) return;
  const name = cleanName(recordName.value);
  try { localStorage.setItem(PLAYER_KEY, name); } catch (_) { /* sin almacenamiento */ }
  const rec = loadRecords();
  const entry = { name, ...pendingRecord };
  pendingRecord = null;
  if (qualifies(rec, entry.score)) {
    // Tras los empates existentes: el récord más antiguo conserva su puesto
    let i = rec.top.findIndex(r => entry.score > r.score);
    if (i === -1) i = rec.top.length;
    rec.top.splice(i, 0, entry);
    rec.top = rec.top.slice(0, MAX_RECORDS);
    saveRecords(rec);
    highlightIdx = i;
    recordMsg.textContent = '¡Nuevo récord!';
  } else {
    // Otra pestaña guardó puntuaciones mejores entretanto
    recordMsg.textContent = 'Ya no entra en el top 5';
  }
  recordName.blur();
  recordForm.classList.add('hidden');
  recordsGameoverTable.classList.remove('hidden');
  // Se pinta desde memoria: coherente aunque localStorage no esté disponible
  renderAllRecords(rec);
}

function clearRecords() {
  if (!confirm('¿Borrar todos los récords?')) return;
  try { localStorage.removeItem(RECORDS_KEY); } catch (_) { /* sin almacenamiento */ }
  highlightIdx = -1;
  if (!pendingRecord) recordMsg.textContent = '';
  renderAllRecords();
}

recordName.maxLength = NAME_MAX;

// Teclas de juego mantenidas al acabar la partida: no escribir su autorrepetición
recordName.addEventListener('keydown', e => {
  if (e.repeat) e.preventDefault();
});

recordForm.addEventListener('submit', e => {
  e.preventDefault(); // Enter en el campo también guarda
  saveRecord();
});

startBtn.addEventListener('click', () => {
  startBtn.blur();
  init();
});

for (const btn of [clearStartBtn, clearGameoverBtn]) {
  btn.addEventListener('click', () => {
    btn.blur();
    clearRecords();
  });
}

// Arranque: se muestra la pantalla de inicio; el juego empieza con «Jugar»
renderAllRecords();
// ==== Fin tabla de récords ===================================================
