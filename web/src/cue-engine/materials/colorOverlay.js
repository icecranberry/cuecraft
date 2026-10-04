export function colorOverlayUniforms(shader, color, opacity) {
  shader.uniforms.wrapColor = color
  shader.uniforms.wrapColorOpacity = opacity
}

export function setColorOverlayUniform(colorUniform, opacityUniform, color, opacity = 1) {
  colorUniform.value.set(color ?? '#ffffff')
  opacityUniform.value = color ? opacity : 0
}

export function colorOverlayFragment(source, printMix) {
  return source
    .replace('#include <common>', '#include <common>\nuniform vec3 wrapColor;\nuniform float wrapColorOpacity;')
    .replace(
      '#include <map_fragment>',
      `#include <map_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, wrapColor, wrapColorOpacity);\n${printMix}`
    )
}
