// Two on-screen touch joysticks (multi-touch via pointer events) plus a
// keyboard fallback for testing on a computer.

const DEAD = 0.07;
function shape(v) {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.pow((a - DEAD) / (1 - DEAD), 1.5);
}

class Stick {
  constructor(el) {
    this.el = el;
    this.knob = el.querySelector('.knob');
    this.x = 0; this.y = 0; this.id = null;
    el.addEventListener('pointerdown', (e) => {
      if (this.id !== null) return;
      this.id = e.pointerId;
      el.setPointerCapture(e.pointerId);
      this.rect = el.getBoundingClientRect();
      el.classList.add('active');
      this._move(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.id) { this._move(e); e.preventDefault(); }
    });
    const end = (e) => {
      if (e.pointerId !== this.id) return;
      this.id = null; this.x = 0; this.y = 0;
      el.classList.remove('active');
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }

  _move(e) {
    const r = this.rect;
    const max = (r.width / 2) * 0.7;
    let dx = (e.clientX - (r.left + r.width / 2)) / max;
    let dy = (e.clientY - (r.top + r.height / 2)) / max;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    this.x = shape(dx);
    this.y = shape(dy);
    this.knob.style.transform =
      `translate(calc(-50% + ${dx * max}px), calc(-50% + ${dy * max}px))`;
  }
}

export class Controls {
  constructor(leftEl, rightEl) {
    this.left = new Stick(leftEl);
    this.right = new Stick(rightEl);
    this.keys = new Set();
    this.invertPitch = false;
    addEventListener('keydown', (e) => { this.keys.add(e.code); });
    addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
  }

  _k(pos, neg) {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  // fwd/side/pitch/roll in -1..1 (pitch positive = nose up)
  read() {
    const L = this.left, Rt = this.right;
    const fwd = L.id !== null ? -L.y : this._k('KeyW', 'KeyS');
    const side = L.id !== null ? L.x : this._k('KeyD', 'KeyA');
    // aircraft convention: pull the stick back (down) for nose up
    let pitch = Rt.id !== null ? Rt.y : this._k('ArrowDown', 'ArrowUp');
    if (this.invertPitch) pitch = -pitch;
    const roll = Rt.id !== null ? Rt.x : this._k('ArrowRight', 'ArrowLeft');
    return { fwd, side, pitch, roll };
  }
}
