export class InputSystem {
  private keys: Map<string, boolean> = new Map();
  private mouseDX: number = 0;
  private mouseDY: number = 0;
  private canvas: HTMLCanvasElement | null = null;

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      this.keys.set(e.code, true);
      // Prevent browser defaults for game keys
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isPointerLocked()) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
  }

  isKeyDown(code: string): boolean {
    return this.keys.get(code) ?? false;
  }

  /** Returns accumulated mouse movement since last call, then resets. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  requestPointerLock(): void {
    this.canvas?.requestPointerLock();
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }
}
