import './style.css';
import { Game } from './core/Game.ts';
import { ThreeJSRenderer } from './renderer/ThreeJSRenderer.ts';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const overlayText = overlay.querySelector('p') as HTMLParagraphElement;

const renderer = new ThreeJSRenderer();
const game = new Game(renderer);

// Read map from URL param, default to map01
const mapName =
  new URLSearchParams(window.location.search).get('map') ?? 'map01';

let initialized = false;

overlay.addEventListener('click', async () => {
  if (!initialized) {
    overlayText.textContent = 'Loading...';
    try {
      await game.init(canvas, mapName);
      initialized = true;
      game.start();
    } catch (err) {
      overlayText.textContent = `Failed to load map: ${mapName}`;
      console.error(err);
      return;
    }
  } else {
    // Resume from pause — request pointer lock (this IS a user gesture)
    game.requestPointerLock();
  }
  overlay.style.display = 'none';
});

// Pause/resume overlay
game.getEventBus().on('game.paused', () => {
  overlay.style.display = 'flex';
  overlayText.textContent = 'Click to resume';
});

game.getEventBus().on('game.resumed', () => {
  overlay.style.display = 'none';
});
