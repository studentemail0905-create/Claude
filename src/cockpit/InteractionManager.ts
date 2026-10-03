import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Cockpit } from './Cockpit';
import type { Control3D } from './controls/Controls3D';
import type { Run } from '../core/Run';
import { clamp, DEG } from '../core/mathutil';
import type { Settings } from '../core/SaveManager';

/**
 * First-person hands: the camera is the head, the reticle is the gaze, the cockpit
 * is the interface. Clicking a switch moves the switch; the simulation reads it.
 */
export class InteractionManager {
  yaw = 0;
  pitch = -8 * DEG;
  zoom = 1;
  hovered: Control3D | null = null;
  dragging: Control3D | null = null;
  stickGrabbed = false;
  private ray = new THREE.Raycaster();
  private center = new THREE.Vector2(0, 0);
  tooltip = '';
  onControl: (c: Control3D, kind: string) => void = () => {};
  private kbStick = { p: 0, r: 0 };
  /** Free-cursor mode: head turns only while dragging empty space. */
  private freeLook = false;

  constructor(private input: Input, private cockpit: Cockpit, public camera: THREE.PerspectiveCamera) {
    this.ray.far = 2.2;
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = -8 * DEG;
    this.zoom = 1;
    this.stickGrabbed = false;
    this.dragging = null;
    this.hovered?.setHover(false);
    this.hovered = null;
  }

  /** Head orientation relative to the ship. */
  headQuat(out = new THREE.Quaternion()): THREE.Quaternion {
    return out.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  update(dt: number, run: Run, settings: Settings): void {
    const input = this.input;
    const cs = run.ship.controls;
    const [mdx, mdy, wheel] = input.takeMouse();
    const sens = settings.sensitivity * 0.0022 / this.zoom;
    const inv = settings.invertY ? -1 : 1;
    const lookHeld = input.buttons.has(2) && this.stickGrabbed;

    for (const b of input.takeDowns()) {
      if (b === 0) {
        if (this.stickGrabbed) {
          this.stickGrabbed = false;
          this.onControl(this.cockpit.stick, 'stick_release');
        } else if (!this.hovered && input.free) {
          this.freeLook = true;
        } else if (this.hovered) {
          const h = this.hovered;
          if (h === this.cockpit.stick) {
            this.stickGrabbed = true;
            this.onControl(h, 'stick_grab');
          } else {
            const moved = h.click(0, cs);
            if (moved) this.onControl(h, h.def.kind);
            else if (h.def && cs.stuck.has(h.id)) this.onControl(h, 'stuck');
            if (h.drag !== 'none') this.dragging = h;
          }
        }
      } else if (b === 2) {
        if (!this.hovered && input.free) this.freeLook = true;
        if (!this.stickGrabbed && this.hovered && this.hovered !== this.cockpit.stick) {
          const moved = this.hovered.click(2, cs);
          if (moved) this.onControl(this.hovered, this.hovered.def.kind);
          else if (cs.stuck.has(this.hovered.id)) this.onControl(this.hovered, 'stuck');
        }
      } else if (b === 1) {
        this.zoom = this.zoom > 1.2 ? 1 : 2.4;
      }
    }
    for (const b of input.takeUps()) {
      if (b === 0 || b === 2) this.freeLook = false;
      if (b === 0 && this.dragging) {
        this.dragging.release(cs);
        this.dragging = null;
      }
      if (b === 0 && this.hovered && this.hovered.def?.kind === 'button') this.hovered.release(cs);
    }

    // mouse motion: drag a control, deflect the stick, or move the head
    if (this.dragging) {
      const before = cs.get(this.dragging.id);
      this.dragging.dragBy(mdx, mdy, cs);
      if (cs.get(this.dragging.id) !== before) this.onControl(this.dragging, this.dragging.def.kind + '_drag');
    } else if (this.stickGrabbed && !lookHeld) {
      cs.stickRoll = clamp(cs.stickRoll + mdx * 0.0042 * settings.sensitivity, -1, 1);
      cs.stickPitch = clamp(cs.stickPitch + mdy * 0.0042 * settings.sensitivity * inv, -1, 1);
    } else if (!input.free || input.locked || this.freeLook) {
      this.yaw -= mdx * sens;
      this.pitch -= mdy * sens * inv;
    }
    this.yaw = clamp(this.yaw, -155 * DEG, 155 * DEG);
    this.pitch = clamp(this.pitch, -85 * DEG, 80 * DEG);

    if (wheel !== 0) {
      if (this.hovered && this.hovered !== this.cockpit.stick && this.hovered.wheel(-wheel, cs)) this.onControl(this.hovered, this.hovered.def.kind);
      else if (!this.hovered) this.zoom = clamp(this.zoom * (wheel < 0 ? 1.15 : 1 / 1.15), 1, 3);
    }

    // keyboard: pedals, brakes, throttle, RCS translation, stick alternative
    const k = (c: string) => input.down(c);
    cs.pedals = clamp((k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0), -1, 1);
    cs.toeBrake = k('KeyB') ? 1 : 0;
    const thr = (k('KeyR') ? 1 : 0) - (k('KeyF') ? 1 : 0);
    if (thr !== 0) {
      cs.set('throttleA', cs.get('throttleA') + thr * dt * 0.5);
      cs.set('throttleB', cs.get('throttleB') + thr * dt * 0.5);
    }
    cs.trans.z = (k('KeyK') ? 1 : 0) - (k('KeyI') ? 1 : 0);
    cs.trans.x = (k('KeyL') ? 1 : 0) - (k('KeyJ') ? 1 : 0);
    cs.trans.y = (k('KeyU') ? 1 : 0) - (k('KeyO') ? 1 : 0);
    const kp = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
    const kr = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const ramp = (cur: number, target: number) => cur + clamp(target - cur, -dt * 3, dt * 3);
    this.kbStick.p = ramp(this.kbStick.p, kp);
    this.kbStick.r = ramp(this.kbStick.r, kr);
    if (kp !== 0 || kr !== 0 || Math.abs(this.kbStick.p) + Math.abs(this.kbStick.r) > 0.01) {
      if (!this.stickGrabbed) {
        cs.stickPitch = this.kbStick.p * inv;
        cs.stickRoll = this.kbStick.r;
      }
    } else if (!this.stickGrabbed) {
      // spring-centred stick
      cs.stickPitch = ramp(cs.stickPitch, 0);
      cs.stickRoll = ramp(cs.stickRoll, 0);
    }
    for (const key of input.takeKeys()) {
      if (key === 'Space') {
        this.yaw = 0;
        this.pitch = -8 * DEG;
        if (this.stickGrabbed) {
          this.stickGrabbed = false;
          cs.stickPitch = cs.stickRoll = 0;
        }
      }
      if (key === 'KeyZ') this.zoom = this.zoom > 1.2 ? 1 : 2.4;
      if (key === 'KeyT') this.stickGrabbed = !this.stickGrabbed;
    }

    // gamepad (optional): left stick = stick, right X = pedals, triggers = throttle
    const gp = input.pollGamepad();
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.08 ? 0 : v);
      const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0), rx = dz(gp.axes[2] ?? 0);
      if (lx || ly) {
        cs.stickRoll = lx;
        cs.stickPitch = ly * inv;
      }
      if (rx) cs.pedals = rx;
      const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
      if (rt > 0.05 || lt > 0.05) {
        cs.set('throttleA', cs.get('throttleA') + (rt - lt) * dt * 0.6);
        cs.set('throttleB', cs.get('throttleB') + (rt - lt) * dt * 0.6);
      }
    }

    // gaze raycast (not while dragging or flying the stick)
    if (!this.dragging && !(this.stickGrabbed && !lookHeld)) {
      if (input.free && !input.locked && !this.freeLook) this.center.set(input.mx, input.my);
      else this.center.set(0, 0);
      this.ray.setFromCamera(this.center, this.camera);
      const hits = this.ray.intersectObjects(this.cockpit.hitMeshes, false);
      const c = hits.length ? (hits[0].object.userData.control as Control3D) : null;
      if (c !== this.hovered) {
        this.hovered?.setHover(false);
        c?.setHover(true);
        this.hovered = c;
      }
    }
    const show = this.dragging ?? (this.stickGrabbed ? this.cockpit.stick : this.hovered);
    this.tooltip = show ? show.label(cs) + (cs.stuck.has(show.id) ? '  [JAMMED]' : '') : '';
  }
}
