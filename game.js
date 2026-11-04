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

// Delegada en la skin activa (ver sección SKINS)
function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  context.globalAlpha = alpha ?? 1;
  SKINS[skinId].drawBlock(context, x * size, y * size, size, palette[colorIndex], alpha ?? 1);
  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

// Aro de la tuerca sobre su celda central vacía
function drawNutHole(context, x, y, size, alpha) {
  context.globalAlpha = alpha ?? 1;
  context.strokeStyle = palette[NUT];
  if (SKINS[skinId].glow) {
    context.shadowColor = palette[NUT];
    context.shadowBlur = size * 0.4;
  }
  context.lineWidth = 3;
  context.beginPath();
  context.arc(x * size + size / 2, y * size + size / 2, size * 0.3, 0, Math.PI * 2);
  context.stroke();
  context.shadowBlur = 0;
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

// ==================== SKINS ====================
// Cada skin define su paleta (9 entradas alineadas con PIECES), el aspecto del
// tablero y cómo se pinta un bloque. Retro sigue el tema claro/oscuro; el resto
// tiene un tablero propio y fijo.
const SKIN_KEY = 'tetris-skin';
const skinSelect = document.getElementById('skin-select');

const COLORS_NEON = [
  null,
  '#00f0ff', // I
  '#fff200', // O
  '#d000ff', // T
  '#39ff14', // S
  '#ff073a', // Z
  '#2f6bff', // J
  '#ff8c00', // L
  '#e0e0ff', // N
];

const COLORS_PASTEL = [
  null,
  '#a8e6f0', // I
  '#ffe9a0', // O
  '#d9b8f0', // T
  '#b8e6c1', // S
  '#f5b5b5', // Z
  '#b5cdf5', // J
  '#ffd1a8', // L
  '#cfd6dc', // N
];

const COLORS_PIXEL = [
  null,
  '#3cbcfc', // I
  '#f8d878', // O
  '#b844f8', // T
  '#58d854', // S
  '#f83800', // Z
  '#0058f8', // J
  '#fc7460', // L
  '#a4a4a4', // N
];

// Rectángulo redondeado con alternativa para navegadores sin roundRect
function roundRectPath(context, x, y, w, h, r) {
  context.beginPath();
  if (context.roundRect) { context.roundRect(x, y, w, h, r); return; }
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

const SKINS = {
  retro: {
    name: 'Retro',
    // Usa las variables CSS del tema activo (comportamiento original)
    look(css) {
      return {
        colors: theme === 'light' ? COLORS_LIGHT : COLORS,
        boardBg: '', // '' = fondo de --board-bg en CSS
        grid: css.getPropertyValue('--grid').trim(),
        ghostAlpha: parseFloat(css.getPropertyValue('--ghost-alpha')) || 0.2,
      };
    },
    drawBlock(context, px, py, size, color) {
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      context.fillStyle = highlightColor;
      context.fillRect(px + 1, py + 1, size - 2, 4);
    },
  },
  neon: {
    name: 'Neón',
    glow: true,
    look: () => ({ colors: COLORS_NEON, boardBg: '#000000', grid: '#10101c', ghostAlpha: 0.3 }),
    drawBlock(context, px, py, size, color, alpha) {
      context.shadowColor = color;
      context.shadowBlur = size * 0.5;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(px + 3, py + 3, size - 6, size - 6);
      context.shadowBlur = 0;
      context.globalAlpha = alpha * 0.35;
      context.fillStyle = color;
      context.fillRect(px + 4, py + 4, size - 8, size - 8);
    },
  },
  pastel: {
    name: 'Pastel',
    look: () => ({ colors: COLORS_PASTEL, boardBg: '#fbf6f1', grid: '#efe5da', ghostAlpha: 0.4 }),
    drawBlock(context, px, py, size, color) {
      const r = size * 0.25;
      context.fillStyle = color;
      roundRectPath(context, px + 2, py + 2, size - 4, size - 4, r);
      context.fill();
      context.fillStyle = 'rgba(255,255,255,0.45)';
      roundRectPath(context, px + 5, py + 4, size - 10, size * 0.25, r / 2);
      context.fill();
    },
  },
  pixel: {
    name: 'Pixel art',
    look: () => ({ colors: COLORS_PIXEL, boardBg: '#101020', grid: '#1c1c34', ghostAlpha: 0.3 }),
    drawBlock(context, px, py, size, color) {
      const u = Math.max(2, Math.round(size / 8)); // tamaño del "píxel"
      context.fillStyle = '#000000';
      context.fillRect(px, py, size, size);
      context.fillStyle = color;
      context.fillRect(px + 1, py + 1, size - 2, size - 2);
      // bisel: claro arriba-izquierda, oscuro abajo-derecha
      context.fillStyle = 'rgba(255,255,255,0.45)';
      context.fillRect(px + 1, py + 1, size - 2, u);
      context.fillRect(px + 1, py + 1, u, size - 2);
      context.fillStyle = 'rgba(0,0,0,0.35)';
      context.fillRect(px + 1, py + size - 1 - u, size - 2, u);
      context.fillRect(px + size - 1 - u, py + 1, u, size - 2);
      // textura de subcuadros
      context.fillStyle = 'rgba(255,255,255,0.7)';
      context.fillRect(px + 1 + u, py + 1 + u, u, u);
      context.fillStyle = 'rgba(0,0,0,0.25)';
      context.fillRect(px + size - 1 - 3 * u, py + size - 1 - 3 * u, u, u);
      context.fillRect(px + size / 2 - u / 2, py + size / 2 - u / 2, u, u);
    },
  },
};

let skinId = 'retro';
try {
  const savedSkin = localStorage.getItem(SKIN_KEY);
  if (savedSkin && Object.hasOwn(SKINS, savedSkin)) skinId = savedSkin;
} catch (_) { /* sin almacenamiento */ }
skinSelect.value = skinId;

// Aplica skin + tema a las variables de dibujo y al fondo de los canvas
function applySkin() {
  const look = SKINS[skinId].look(getComputedStyle(document.documentElement));
  palette = look.colors;
  gridColor = look.grid;
  ghostAlpha = look.ghostAlpha;
  for (const cv of [canvas, nextCanvas, holdCanvas]) cv.style.background = look.boardBg;
}

function setSkin(id) {
  if (!Object.hasOwn(SKINS, id)) return;
  skinId = id;
  try { localStorage.setItem(SKIN_KEY, skinId); } catch (_) { /* sin almacenamiento */ }
  applySkin();
  // La vista previa no se redibuja por frame
  if (next) { drawNext(); drawHold(); }
}

skinSelect.addEventListener('change', () => {
  setSkin(skinSelect.value);
  skinSelect.blur(); // devuelve las teclas al juego
});

// Con el selector enfocado, las teclas de juego mueven la pieza, no la skin
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
  'KeyX', 'KeyC', 'KeyP', 'ShiftLeft', 'ShiftRight']);
skinSelect.addEventListener('keydown', e => {
  if (!GAME_KEYS.has(e.code)) return;
  if (e.code !== 'KeyP' && (paused || gameOver)) return; // sin partida activa: uso normal
  e.preventDefault();
  skinSelect.blur();
});
// ================== FIN SKINS ==================

function setTheme(newTheme, save = true) {
  theme = newTheme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  highlightColor = getComputedStyle(document.documentElement).getPropertyValue('--highlight').trim();
  applySkin(); // paleta, rejilla, fantasma y fondo dependen de skin + tema
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
