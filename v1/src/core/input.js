// Keyboard + mouse with pointer lock. Edge-triggered presses are consumed once per frame.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false, middle: false, wheel: 0 };
    this.mousePressed = new Set();
    this.mouseReleased = new Set();
    this.locked = false;
    this.sensitivity = 0.0021;
    this.enabled = true;
    addEventListener('keydown', e => {
      if (e.repeat) return;
      if (['Space', 'Tab', 'ControlLeft', 'AltLeft'].includes(e.code)) e.preventDefault();
      this.down.add(e.code); this.pressed.add(e.code);
    });
    addEventListener('keyup', e => { this.down.delete(e.code); this.released.add(e.code); });
    addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = this.mouse.middle = false; });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked && this.wantLock) { canvas.requestPointerLock?.(); }
      this.setButton(e.button, true);
    });
    addEventListener('mouseup', e => this.setButton(e.button, false));
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  setButton(b, v) {
    const k = b === 0 ? 'left' : b === 2 ? 'right' : 'middle';
    if (this.mouse[k] !== v) (v ? this.mousePressed : this.mouseReleased).add(k);
    this.mouse[k] = v;
  }
  lock() { this.wantLock = true; this.canvas.requestPointerLock?.(); }
  unlock() { this.wantLock = false; document.exitPointerLock?.(); }
  key(code) { return this.enabled && this.down.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  up(code) { return this.enabled && this.released.has(code); }
  btn(k) { return this.enabled && this.mouse[k]; }
  btnHit(k) { return this.enabled && this.mousePressed.has(k); }
  btnUp(k) { return this.enabled && this.mouseReleased.has(k); }
  consumeMouse() {
    const d = { dx: this.mouse.dx * this.sensitivity, dy: this.mouse.dy * this.sensitivity * (this.invertY ? -1 : 1), wheel: this.mouse.wheel };
    this.mouse.dx = this.mouse.dy = 0; this.mouse.wheel = 0;
    return this.enabled ? d : { dx: 0, dy: 0, wheel: 0 };
  }
  endFrame() { this.pressed.clear(); this.released.clear(); this.mousePressed.clear(); this.mouseReleased.clear(); }
}
