export function colorOverlayUniforms(
  shader: { uniforms: Record<string, unknown> },
  color: unknown,
  opacity: unknown
): void;

export function setColorOverlayUniform(
  color: { value: { set(value: string): void } },
  opacity: { value: number },
  colorValue: string | undefined,
  opacityValue?: number
): void;

export function colorOverlayFragment(source: string, printMix: string): string;
