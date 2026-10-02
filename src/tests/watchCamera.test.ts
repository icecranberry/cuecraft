import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three-stdlib';
import { bindCueAxisSnap } from '../three/watchCamera';

// Exercise real right-button pan followed by left-button orbit, including damping.
function setup() {
  const ownerDocument = new EventTarget();
  const canvas = Object.assign(new EventTarget(), {
    style: { touchAction: '' }, clientWidth: 1000, clientHeight: 600,
    ownerDocument, releasePointerCapture() {}
  });
  const camera = new PerspectiveCamera(30, 1000 / 600, 1, 30000);
  camera.position.set(400, 350, 1700);
  const controls = new OrbitControls(camera, canvas as unknown as HTMLElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  bindCueAxisSnap(controls, 1474);
  function settle() {
    for (let i = 0; i < 240; i++) controls.update();
    camera.updateMatrixWorld();
  }
  function drag(button: number, dx: number, dy: number) {
    const fire = (target: EventTarget, type: string, x: number, y: number) => {
      target.dispatchEvent(Object.assign(new Event(type), {
        pointerId: 1, pointerType: 'mouse', button, clientX: x, clientY: y
      }));
    };
    fire(canvas, 'pointerdown', 500, 300);
    fire(ownerDocument, 'pointermove', 500 + dx, 300 + dy);
    camera.updateMatrixWorld();
    const beforeRelease = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: controls.target.clone(), projected: [new Vector3(), new Vector3(-737, 0, 0), new Vector3(737, 15, 0)].map((p) => p.project(camera)) };
    fire(ownerDocument, 'pointerup', 500 + dx, 300 + dy);
    settle();
    return beforeRelease;
  }
  settle();
  return { camera, controls, drag };
}

describe('观看模式：平移后吸附最近的球杆中轴点', () => {
  it('右键平移后，左键绕新的中心旋转，不回到球杆原点', () => {
    const { camera, controls, drag } = setup();
    drag(2, 170, -80);
    const pivot = controls.target.clone();
    expect(pivot.length()).toBeGreaterThan(10);
    expect(pivot.y).toBe(0);
    expect(pivot.z).toBe(0);
    const pivotScreen = pivot.clone().project(camera);
    const cueBefore = new Vector3().project(camera);
    const distance = camera.position.distanceTo(pivot);
    drag(0, 130, 50);
    expect(controls.target.distanceTo(pivot)).toBeLessThan(1e-7);
    expect(pivot.clone().project(camera).distanceTo(pivotScreen)).toBeLessThan(1e-7);
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(distance, 7);
    expect(new Vector3().project(camera).distanceTo(cueBefore)).toBeGreaterThan(0.01);
    expect(camera.view?.enabled).not.toBe(true);
    controls.dispose();
  });

  it('再次平移会更新中心，后续旋转保持新的中心', () => {
    const { camera, controls, drag } = setup();
    drag(2, 130, 50);
    drag(0, 90, 30);
    const first = controls.target.clone();
    drag(2, -60, 100);
    const second = controls.target.clone();
    expect(second.distanceTo(first)).toBeGreaterThan(1);
    const pivotScreen = second.clone().project(camera);
    expect(second.y).toBe(0);
    expect(second.z).toBe(0);
    drag(0, -120, -20);
    expect(controls.target.distanceTo(second)).toBeLessThan(1e-7);
    expect(second.clone().project(camera).distanceTo(pivotScreen)).toBeLessThan(1e-7);
    controls.dispose();
  });

  it('吸附选择最近的轴向点，并限制在球杆两端内', () => {
    const { camera, controls } = setup();
    for (const [point, expectedX] of [[new Vector3(230, 80, -70), 230], [new Vector3(2000, 10, 20), 737], [new Vector3(-2000, 10, 20), -737]] as const) {
      controls.dispatchEvent({ type: 'start', target: controls });
      controls.target.copy(point);
      controls.dispatchEvent({ type: 'end', target: controls });
      expect(controls.target.toArray()).toEqual([expectedX, 0, 0]);
      for (let i = 0; i < 120; i++) controls.update();
      camera.updateMatrixWorld();
      expect(controls.target.toArray()).toEqual([expectedX, 0, 0]);

    }
    controls.dispose();
  });

  it('松开右键及后续帧不移动相机、不回正画面，同时仍吸附最近中轴点', () => {
    const { camera, controls, drag } = setup();
    for (const [dx, dy] of [[170, -80], [-100, 120], [50, 35]]) {
      const before = drag(2, dx, dy);
      expect(camera.position.distanceTo(before.position)).toBeLessThan(1e-7);
      expect(1 - Math.abs(camera.quaternion.dot(before.quaternion))).toBeLessThan(1e-10);
      const after = [new Vector3(), new Vector3(-737, 0, 0), new Vector3(737, 15, 0)].map((p) => p.project(camera));
      after.forEach((p, i) => expect(p.distanceTo(before.projected[i])).toBeLessThan(1e-7));
      expect(controls.target.x).toBeCloseTo(Math.max(-737, Math.min(737, before.target.x)), 7);
      expect(controls.target.y).toBe(0);
      expect(controls.target.z).toBe(0);
      drag(0, 40, 20);
    }
    controls.dispose();
  });

});
