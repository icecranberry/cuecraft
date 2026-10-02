import { Quaternion } from 'three';
import type { OrbitControls } from 'three-stdlib';

/** Change the orbit pivot without changing the camera pose at pointer release. */
export function bindCueAxisSnap(controls: OrbitControls, lengthMm: number) {
  const camera = controls.object;
  const startTarget = controls.target.clone();
  // OrbitControls aims at its pivot. Retain the viewing-direction offset separately
  // so snapping the pivot never recenters the image.
  const lookOffset = new Quaternion();
  const originalUpdate = controls.update;
  const update = () => {
    const changed = originalUpdate();
    camera.quaternion.multiply(lookOffset);
    camera.updateMatrixWorld();
    return changed;
  };
  controls.update = update;
  const onStart = () => startTarget.copy(controls.target);
  const onEnd = () => {
    if (controls.target.distanceToSquared(startTarget) < 1e-12) return;
    const position = camera.position.clone();
    const orientation = camera.quaternion.clone();
    const pivotX = Math.max(-lengthMm / 2, Math.min(lengthMm / 2, controls.target.x));
    const damping = controls.enableDamping;
    try {
      // Clear pending inertia, then restore the exact visible pose (do not apply
      // the remaining pan as a sudden extra movement on release).
      controls.enableDamping = false;
      originalUpdate();
      camera.position.copy(position);
      controls.target.set(pivotX, 0, 0);
      originalUpdate();
      lookOffset.copy(camera.quaternion).invert().multiply(orientation);
      camera.quaternion.copy(orientation);
      camera.updateMatrixWorld();
    } finally {
      controls.enableDamping = damping;
    }
  };
  controls.addEventListener('start', onStart);
  controls.addEventListener('end', onEnd);
  return () => {
    if (controls.update === update) controls.update = originalUpdate;
    controls.removeEventListener('start', onStart);
    controls.removeEventListener('end', onEnd);
  };
}
