/** Raw input collection: keyboard, mouse (pointer lock), wheel, gamepad. */
export class Input {
  keys = new Set<string>();
  dx = 0;
  dy = 0;
  wheel = 0;
  buttons = new Set<number>();
  locked = false;
  private lockedAt = 0;
  private downQueue: number[] = [];
  private upQueue: number[] = [];
  private keyQueue: string[] = [];
  gamepad: Gamepad | null = null;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!this.keys.has(e.code)) this.keyQueue.push(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    el.addEventListener('mousemove', (e) => {
      if (!this.locked || performance.now() - this.lockedAt < 120) return;
      // browsers occasionally report a huge spike right after locking
      if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.downQueue.push(e.button);
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (this.buttons.has(e.button)) this.upQueue.push(e.button);
      this.buttons.delete(e.button);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      this.lockedAt = performance.now();
      this.dx = this.dy = 0;
      if (!this.locked) this.buttons.clear();
    });
  }

  requestLock(): void {
    try {
      const p = (this.el as any).requestPointerLock?.({ unadjustedMovement: false });
      if (p && typeof p.catch === 'function') p.catch(() => (this.el as any).requestPointerLock?.());
    } catch {
      /* some browsers throw if called too soon after exit */
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  takeDowns(): number[] {
    const q = this.downQueue;
    this.downQueue = [];
    return q;
  }
  takeUps(): number[] {
    const q = this.upQueue;
    this.upQueue = [];
    return q;
  }
  takeKeys(): string[] {
    const q = this.keyQueue;
    this.keyQueue = [];
    return q;
  }
  takeMouse(): [number, number, number] {
    const r: [number, number, number] = [this.dx, this.dy, this.wheel];
    this.dx = this.dy = this.wheel = 0;
    return r;
  }

  pollGamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.gamepad = null;
    for (const p of pads) if (p && p.connected) {
      this.gamepad = p;
      break;
    }
    return this.gamepad;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }
}
