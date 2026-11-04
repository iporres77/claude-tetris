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

// ---- Menú de pausa: referencias y estado ----
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const controlsBtn = document.getElementById('controls-btn');
const pauseControls = document.getElementById('pause-controls');
const startLevelSelect = document.getElementById('start-level');
const START_LEVEL_KEY = 'tetris-start-level';
const MAX_START_LEVEL = 15;
const RESUME_LOCK_MS = 150;
let startLevel = 1;       // elegido en el menú; se aplica en la próxima partida
let gameStartLevel = 1;   // nivel inicial de la partida en curso (fijado por init)
let inputLockUntil = 0;   // ignora teclas de juego justo después de reanudar
let ignoreRepeat = false; // ignora teclas mantenidas desde antes de reanudar
// ---- Fin menú de pausa: referencias y estado ----

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

function speedForLevel(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
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
    level = Math.max(gameStartLevel, Math.floor(lines / 10) + 1);
    dropInterval = speedForLevel(level);
    updateHUD();
  }
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
}

// ---- Menú de pausa ----
function togglePause() {
  if (gameOver) return;
  if (paused) resumeGame();
  else openPauseMenu();
}

function openPauseMenu() {
  paused = true;
  cancelAnimationFrame(animId);
  setControlsOpen(false);
  pauseMenu.classList.remove('hidden');
  resumeBtn.focus();
}

function closePauseMenu() {
  pauseMenu.classList.add('hidden');
  // Ningún control debe conservar el foco (flechas/Space/Enter actuarían sobre él)
  const active = document.activeElement;
  if (active && active !== document.body) active.blur();
}

// Evita movimientos accidentales con teclas pulsadas o mantenidas al volver al juego
function lockInputBriefly() {
  inputLockUntil = performance.now() + RESUME_LOCK_MS;
  ignoreRepeat = true;
}

function resumeGame() {
  closePauseMenu();
  paused = false;
  dropAccum = 0;
  lockInputBriefly();
  lastTime = performance.now();
  loop(lastTime);
}

function setControlsOpen(open) {
  pauseControls.classList.toggle('hidden', !open);
  controlsBtn.setAttribute('aria-expanded', String(open));
  controlsBtn.textContent = open ? 'Ocultar controles' : 'Ver controles';
}

function setStartLevel(value, save = true) {
  const n = parseInt(value, 10);
  startLevel = Number.isFinite(n) ? Math.min(MAX_START_LEVEL, Math.max(1, n)) : 1;
  startLevelSelect.value = String(startLevel);
  if (save) {
    try { localStorage.setItem(START_LEVEL_KEY, String(startLevel)); } catch (_) { /* sin almacenamiento */ }
  }
}

for (let i = 1; i <= MAX_START_LEVEL; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = String(i);
  startLevelSelect.appendChild(opt);
}

let savedStartLevel = null;
try { savedStartLevel = localStorage.getItem(START_LEVEL_KEY); } catch (_) { /* ignorar */ }
setStartLevel(savedStartLevel ?? 1, false);

resumeBtn.addEventListener('click', () => {
  resumeBtn.blur();
  resumeGame();
});

pauseRestartBtn.addEventListener('click', () => {
  pauseRestartBtn.blur();
  init();
  lockInputBriefly();
});

controlsBtn.addEventListener('click', () => {
  setControlsOpen(pauseControls.classList.contains('hidden'));
});

startLevelSelect.addEventListener('change', () => {
  setStartLevel(startLevelSelect.value);
});
// ---- Fin menú de pausa ----

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
  board = createBoard();
  score = 0;
  lines = 0;
  gameStartLevel = startLevel;
  level = gameStartLevel;
  paused = false;
  gameOver = false;
  dropInterval = speedForLevel(level);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  hold = 0;
  setHoldUsed(false);
  drawHold();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  closePauseMenu();
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (!e.repeat) togglePause();
    e.preventDefault();
    return;
  }
  // Con el menú abierto solo funciona la navegación del propio menú
  if (paused || gameOver) {
    // Sin foco en un control, flechas/Space no deben desplazar la página
    if (document.activeElement === document.body &&
        (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
    return;
  }
  if (performance.now() < inputLockUntil || (e.repeat && ignoreRepeat)) {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    return;
  }
  if (!e.repeat) ignoreRepeat = false;
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

restartBtn.addEventListener('click', () => {
  restartBtn.blur(); // evita que Space vuelva a reiniciar durante la partida
  init();
});

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

init();
