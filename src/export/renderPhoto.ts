import * as THREE from 'three';
import { canvasToBlob } from '../state/imageStore';
import { useStore } from '../state/store';
import { expandedSegments, resolveTemplate } from '../cue/templates';
import { partAppearance } from '../cue/partAppearance';
import { tailPrintSegment } from '../cue/tailPrint';
import { presetById } from '../materials/presets';
import { presetTextures } from '../materials/textures';
import { createCueMaterial, type CueMaterialHandle } from '../materials/factory';
import { canvasToTexture, composeFacePrint, composeSegmentPrint, getCachedStickerImage, getStickerImage } from '../stickers/composite';
import { stickerOverlapsSegment } from '../cue/mapping';
import { previewPrintResolution } from '../stickers/previewResolution';

export const photoSource: { current: { scene: THREE.Scene; camera: THREE.Camera; renderer: THREE.WebGLRenderer } | null } = { current: null };

/** Uses an independent context so exporting never resizes or resets the workbench. */
export type PhotoFrame = 'current' | 'whole' | 'butt' | 'joint' | 'tip' | 'tail';
export interface PhotoOptions { frame?: PhotoFrame; size?: 2048 | 3840 }
export async function renderPhoto(options: PhotoOptions = {}): Promise<Blob> {
  const source = photoSource.current;
  if (!source) throw new Error('渲染器未就绪');
  const scene = source.scene.clone();
  const design = useStore.getState().design;
  const template = resolveTemplate(design.cueTemplateId, design.decorativeRings, design.partOverrides);
  const segments = expandedSegments(template);
  scene.environment = null;
  const handles: CueMaterialHandle[] = [];
  const prints: THREE.Texture[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!object.userData.surfaceKind) { object.visible = false; return; }
    object.geometry = object.geometry.clone(); geometries.push(object.geometry);
  });
  const camera = source.camera.clone();
  if (options.frame && options.frame !== 'current' && camera instanceof THREE.PerspectiveCamera) {
    const bounds = new THREE.Box3();
    const frame = options.frame;
    scene.updateMatrixWorld(true);
    scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.userData.surfaceKind) return;
      const id = object.userData.segId ?? object.userData.faceId;
      const matches = frame === 'whole' || (frame === 'butt' && ['joint', 'ring-joint', 'butt-forearm', 'ring-deco', 'grip', 'butt-cap', 'face-butt'].includes(id)) || (frame === 'joint' && ['joint', 'ring-joint'].includes(id)) || (frame === 'tip' && ['tip', 'ferrule', 'face-tip'].includes(id)) || (frame === 'tail' && id === 'face-butt');
      if (matches) bounds.expandByObject(object);
    });
    if (!bounds.isEmpty()) {
      const center = bounds.getCenter(new THREE.Vector3()), span = bounds.getSize(new THREE.Vector3());
      const distance = Math.max(50, span.x / camera.aspect, span.y) * 1.3 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      camera.clearViewOffset();
      camera.position.copy(center).addScaledVector(new THREE.Vector3(frame === 'tip' ? -0.38 : 0.38, 0.34, 0.86).normalize(), distance);
      camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    }
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = source.renderer.outputColorSpace;
  renderer.toneMapping = source.renderer.toneMapping;
  renderer.toneMappingExposure = source.renderer.toneMappingExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  scene.traverse((object) => {
    if (object instanceof THREE.DirectionalLight && object.intensity > 0.5) {
      object.castShadow = true;
      Object.assign(object.shadow.camera, { left: -1100, right: 1100, top: 1100, bottom: -1100, near: 1, far: 3000 });
      object.shadow.camera.updateProjectionMatrix();
      object.shadow.mapSize.set(2048, 2048);
      object.shadow.normalBias = 0.2;
      object.shadow.radius = 4;
      object.shadow.blurSamples = 8;
    }
  });
  const floorGeometry = new THREE.PlaneGeometry(6000, 6000);
  const floorMaterial = new THREE.ShadowMaterial({ opacity: 0.2 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -26; floor.receiveShadow = true;
  scene.add(floor);
  const size = source.renderer.getSize(new THREE.Vector2());
  const scale = Math.min((options.size ?? 3840) / Math.max(size.x, size.y), renderer.capabilities.maxTextureSize / Math.max(size.x, size.y));
  const width = Math.max(1, Math.round(size.x * scale));
  const height = Math.max(1, Math.round(size.y * scale));
  // Render-target textures belong to their original context. Rebuild the studio cards here.
  const studio = new THREE.Scene();
  const cards: Array<[number, string, number[], number[]]> = [
    [2.6, '#fff8ef', [0, 360, 300], [1300, 210, 1]],
    [1.4, '#f1f5fa', [0, 80, -420], [1250, 46, 1]],
    [0.45, '#ffffff', [-260, -110, 400], [900, 260, 1]],
    [0.22, '#ddd5c8', [0, -360, 0], [1400, 500, 1]],
    [0.8, '#fff8ef', [1300, 0, 0], [350, 350, 1]],
    [0.6, '#edf2f5', [-1300, 0, 0], [350, 350, 1]]
  ];
  const cardGeometry = new THREE.PlaneGeometry(1, 1);
  const cardMaterials: THREE.Material[] = [];
  for (const [intensity, color, position, scale] of cards) {
    const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide, toneMapped: false });
    const mesh = new THREE.Mesh(cardGeometry, material);
    mesh.position.fromArray(position); mesh.scale.fromArray(scale);
    if (Math.abs(position[0]) === 1300) mesh.rotation.y = Math.PI / 2;
    studio.add(mesh); cardMaterials.push(material);
  }
  const environment = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
  const probe = new THREE.CubeCamera(1, 2000, environment);
  try {
    await Promise.all(design.stickers.filter((sticker) => !sticker.hidden).map(getStickerImage));
    const meshes: THREE.Mesh[] = [];
    scene.traverse((object) => { if (object instanceof THREE.Mesh && object.userData.surfaceKind) meshes.push(object); });
    for (const mesh of meshes) {
      const segment = segments.find((part) => part.id === mesh.userData.segId);
      const face = template.faces.find((part) => part.id === mesh.userData.faceId);
      const part = segment ?? face;
      if (!part) continue;
      const appearance = partAppearance(template, part.id, design.partOverrides);
      const override = appearance.override;
      const preset = presetById(appearance.presetId ?? part.matPreset);
      await presetTextures(preset).ready;
      const widthMm = segment ? Math.PI * (segment.r0 + segment.r1) : face!.radius * 2;
      const heightMm = segment ? segment.a1 - segment.a0 : face!.radius * 2;
      const handle = createCueMaterial({ preset, finishId: override?.finish ?? design.globalFinish, colorOverride: override?.color, circMm: widthMm, lenMm: heightMm, axialOriginMm: segment?.a0, surface: face ? 'face' : 'lathe', partKind: segment?.kind ?? (face?.id === 'face-butt' ? 'butt' : undefined) });
      handles.push(handle); mesh.material = handle.material;
      if (face?.id === 'face-butt') {
        const strip = tailPrintSegment(template);
        const continuation = strip ? design.stickers.filter((sticker) => stickerOverlapsSegment(sticker, strip)) : [];
        if (strip && continuation.length) {
          const { ppm, maxDim } = previewPrintResolution(2 * Math.PI * strip.r0, strip.a1 - strip.a0, continuation, getCachedStickerImage, 'sharp', false, renderer.capabilities.maxTextureSize);
          const texture = canvasToTexture(composeSegmentPrint(strip, continuation, ppm, maxDim, segments).canvas, renderer.capabilities.getMaxAnisotropy());
          prints.push(texture); handle.setContinuationMap(texture);
        }
      }
      const stickers = design.stickers.filter((sticker) => !sticker.hidden && (segment ? stickerOverlapsSegment(sticker, segment) : sticker.target.kind === 'face' && sticker.target.faceId === face!.id));
      if (part.printEnabled && stickers.length) {
        const { ppm, maxDim } = previewPrintResolution(widthMm, heightMm, stickers, getCachedStickerImage, 'sharp', false, renderer.capabilities.maxTextureSize);
        const canvas = segment ? composeSegmentPrint(segment, stickers, ppm, maxDim, segments).canvas : composeFacePrint(face!, stickers, ppm, maxDim).canvas;
        const texture = canvasToTexture(canvas, renderer.capabilities.getMaxAnisotropy());
        prints.push(texture); handle.setPrintMap(texture);
      }
    }
    probe.update(renderer, studio);
    scene.environment = environment.texture;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    await renderer.compileAsync(scene, camera);
    renderer.render(scene, camera);
    return await canvasToBlob(renderer.domElement);
  } finally {
    handles.forEach((handle) => handle.dispose()); prints.forEach((texture) => texture.dispose()); geometries.forEach((geometry) => geometry.dispose());
    cardGeometry.dispose(); cardMaterials.forEach((material) => material.dispose()); environment.dispose();
    floorGeometry.dispose(); floorMaterial.dispose();
    scene.traverse((object) => { if (object instanceof THREE.DirectionalLight) object.shadow.dispose(); });
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
