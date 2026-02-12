export class InputSystem {
  private keys: Map<string, boolean> = new Map();
  /** Keys pressed this frame (consumed on read via wasKeyPressed). */
  private justPressed: Set<string> = new Set();
  private mouseDX: number = 0;
  private mouseDY: number = 0;
  private mouseButtonDown: boolean = false;
  private scrollDelta: number = 0;
  private canvas: HTMLCanvasElement | null = null;

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (!this.keys.get(e.code)) {
        this.justPressed.add(e.code);
      }
      this.keys.set(e.code, true);
      // Prevent browser defaults for game keys
      if (
        [
          'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
          'Tab', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5',
          'KeyE',
        ].includes(e.code)
      ) {
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

    document.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.isPointerLocked()) {
        this.mouseButtonDown = true;
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseButtonDown = false;
      }
    });

    document.addEventListener('wheel', (e) => {
      if (this.isPointerLocked()) {
        this.scrollDelta += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  }

  isKeyDown(code: string): boolean {
    return this.keys.get(code) ?? false;
  }

  /**
   * Returns true once per key press (consumed on first read).
   * Use for one-shot actions like weapon switching or use key.
   */
  wasKeyPressed(code: string): boolean {
    if (this.justPressed.has(code)) {
      this.justPressed.delete(code);
      return true;
    }
    return false;
  }

  /** Whether the left mouse button is currently held down. */
  isMouseDown(): boolean {
    return this.mouseButtonDown;
  }

  /** Returns accumulated mouse movement since last call, then resets. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  /** Returns accumulated scroll wheel delta since last call, then resets. */
  consumeScrollDelta(): number {
    const delta = this.scrollDelta;
    this.scrollDelta = 0;
    return delta;
  }

  /**
   * Clear one-shot state at end of frame.
   * Call this AFTER all systems have had a chance to read input.
   */
  endFrame(): void {
    this.justPressed.clear();
  }

  requestPointerLock(): void {
    this.canvas?.requestPointerLock();
  }

  isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }
}
