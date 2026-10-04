import * as THREE from 'three';

// Cue geometry runs along X: negative X is the tip, positive X is the butt.
// Keep the butt below the tip while it circles the world vertical axis.
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const INITIAL_BUTT_DIRECTION = new THREE.Vector3(0.75, -0.64, 0.14).normalize();
const INITIAL_ORIENTATION = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(1, 0, 0), INITIAL_BUTT_DIRECTION
);

export const WATCH_ORBIT_SPEED = Math.PI * 2 / 18;

export function watchCueOrientation(angle: number, out = new THREE.Quaternion()): THREE.Quaternion {
  return out.setFromAxisAngle(WORLD_UP, -angle).multiply(INITIAL_ORIENTATION);
}
