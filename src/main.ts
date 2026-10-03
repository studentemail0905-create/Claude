import './style.css';
import { Game } from './core/Game';

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

const boot = document.getElementById('boot')!;
if (!supportsWebGL2()) {
  boot.querySelector('.boot-msg')!.textContent = 'Your browser lacks WebGL 2. Your application to leave has been denied by your hardware.';
} else {
  const debug = new URLSearchParams(location.search).has('debug');
  try {
    new Game(document.getElementById('app')!, debug);
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 900);
  } catch (e) {
    console.error(e);
    boot.querySelector('.boot-msg')!.textContent = 'Initialisation failed: ' + (e as Error).message;
  }
}
