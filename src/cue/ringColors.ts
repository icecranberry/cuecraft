import type { PartOverride } from '../core/types';

export function isMetalRing(id: string) {
  return id === 'joint' || id === 'ring-joint' || id === 'ring-deco';
}

/** Keep the connector sleeve and band in the same metal, including legacy designs. */
export function ringOverride(id: string, overrides: Record<string, PartOverride>): PartOverride | undefined {
  if (!isMetalRing(id)) return overrides[id];
  const source = id === 'ring-deco' ? overrides[id] : overrides['ring-joint']?.matPreset ? overrides['ring-joint'] : overrides.joint;
  return { ...overrides[id], matPreset: source?.matPreset === 'stainless' ? 'stainless' : 'brass', color: undefined };
}
