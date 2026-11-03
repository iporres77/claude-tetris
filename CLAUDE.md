# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no build, lint, or test tooling, and no `package.json`. To run the game, open `index.html` directly (`start index.html` on Windows) or serve the directory with any static server (e.g. `python3 -m http.server 8000`, then visit `http://localhost:8000`). Changes must be verified by playing in a browser.

## Architecture

Vanilla JavaScript Tetris on HTML5 Canvas with no dependencies. All logic lives in `game.js`, a classic script (not an ES module) whose state is held in top-level `let` variables and reset by `init()`, which also serves as the restart handler.

- **Piece and color data are index-aligned.** `PIECES[n]` is a matrix whose filled cells contain `n`, and `COLORS[n]` is its color; index 0 is `null` in both. `merge()` copies those values onto the board, so a board cell is `0` (empty) or a color index.
- **Rendering is separate from state changes.** The `requestAnimationFrame` `loop` redraws the whole board every frame via `draw()`, so keydown handlers only mutate state. The HUD and next-piece preview are not redrawn per frame: they update through `updateHUD()` and `drawNext()`.
- **All movement goes through `collide(shape, x, y)`,** including rotation wall kicks (`tryRotate`) and the ghost piece (`ghostY`).
- **Locking runs in a fixed sequence:** `lockPiece()` calls `merge()`, then `clearLines()` (which applies scoring, level, and speed), then `spawn()`. Game over is triggered in `spawn()` when a new piece collides immediately.

## Conventions

- User-facing text and the README are in Spanish; keep new UI strings in Spanish. `README.md` documents the game's behavior and tunable constants, so update it when those change.
- Canvas dimensions are hardcoded in `index.html`. If `COLS`, `ROWS`, or `BLOCK` change, update `<canvas id="board">` to match (`COLS × BLOCK` by `ROWS × BLOCK`). The preview likewise relies on `next-canvas` being 120px, matching 4 cells of `NB = 30` in `drawNext()`.
