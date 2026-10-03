import { ringOverride } from '../cue/ringColors';
import { appearancePartId, partAppearance } from '../cue/partAppearance';
import { tailPrintSegment } from '../cue/tailPrint';
import * as THREE from 'three';
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent, type Intersection } from '@react-three/fiber';
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from '@react-three/drei';
import type { CueTemplate, DesignSnapshot, FaceSpec, SegmentSpec, StickerInstance } from '../core/types';
import { expandedSegments, faceById, segmentById, resolveTemplate } from '../cue/templates';
import { buildSegmentGeometry } from '../cue/geometry';
import { buildDisplaySegmentGeometry, buildDisplayFaceGeometry, bumperSurfaceFrame } from '../cue/displayGeometry';
import { photoSource } from '../export/renderPhoto';
import {
  angDelta,
  faceUvToSurface,
  latheUvToSurface,
  moveStickerTo,
  pickSticker,
  radiusAtSeg,
  stickerCanvasCenter,
  stickerOverlapsSegment,
  type SurfaceHit
} from '../cue/mapping';
import { presetById } from '../materials/presets';
import { createCueMaterial, type CueMaterialHandle } from '../materials/factory';
import {
  canvasToTexture,
  composeFacePrint,
  composeSegmentPrint,
  getCachedStickerImage,
  getStickerImage,
  stickerAlphaAt
} from '../stickers/composite';
import { useStore, nextStickerId } from '../state/store';
import { blobUrl } from '../state/imageStore';
import { partFocusDistance } from './framing';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { bindCueAxisSnap } from './watchCamera';
import { previewPrintResolution } from '../stickers/previewResolution';
import { prepareSceneStartup, SceneStartup } from './startup';

const StartupContext = createContext<SceneStartup | null>(null);

// 三维工作台（plan.md §3/§5.4）：单个实时渲染场景，部件拾取、贴纸拖放、视角控制。

const DEFAULT_STICKER_W = 88; // 原默认宽度的 400%；高度按素材比例同步放大。

export function sceneX(totalLen: number, a: number) {
  return a - totalLen / 2;
}

export const BG_COLORS: Record<string, string> = {
  neutral: '#e8eae2',
  bright: '#f3f3ed',
  dark: '#191c21'
};

function surfaceFromIntersection(
  hit: { object: THREE.Object3D; uv?: THREE.Vector2 },
  tpl: CueTemplate
): SurfaceHit | null {
  const obj = hit.object as THREE.Mesh;
  const data = obj.userData as { surfaceKind?: 'lathe' | 'face'; segId?: string; faceId?: string };
  if (!hit.uv) return null;
  if (data.surfaceKind === 'lathe' && data.segId) {
    const seg = segmentById(tpl, data.segId);
    if (!seg) return null;
    return latheUvToSurface(seg, hit.uv.x, hit.uv.y);
  }
  if (data.surfaceKind === 'face' && data.faceId) {
    const face = faceById(tpl, data.faceId);
    if (!face) return null;
    return faceUvToSurface(face, hit.uv.x, hit.uv.y);
  }
  return null;
}

// —— 贴纸放置预览 ——

export const ghostState = {
  active: false,
  pos: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  w: DEFAULT_STICKER_W,
  h: DEFAULT_STICKER_W
};

function GhostSticker() {
  const placementAssetId = useStore((s) => s.placementAssetId);
  const meshRef = useRef<THREE.Mesh>(null);
  const [tex, setTex] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let dead = false;
    if (!placementAssetId) {
      setTex(null);
      ghostState.active = false;
      return;
    }
    (async () => {
      const url = await blobUrl(`blob:${placementAssetId}`);
      if (!url || dead) return;
      const img = new Image();
      img.onload = () => {
        if (dead) return;
        const t = new THREE.Texture(img);
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        ghostState.h = ghostState.w * (img.naturalHeight / img.naturalWidth);
        setTex(t);
      };
      img.src = url;
    })();
    return () => {
      dead = true;
    };
  }, [placementAssetId]);

  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    const visible = !!tex && ghostState.active && !!placementAssetId;
    m.visible = visible;
    if (!visible) return;
    m.position.copy(ghostState.pos);
    m.quaternion.copy(ghostState.quat);
    m.scale.set(ghostState.w, ghostState.h, 1);
  });

  if (!placementAssetId) return null;
  return (
    <mesh ref={meshRef} renderOrder={10}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={tex ?? undefined} transparent opacity={0.8} depthTest={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// 选框直接投影为屏幕 SVG，线宽与角点不随贴纸尺寸或相机缩放而拉伸。
const overlayScreenOrigin = (): [number, number] => [0, 0];

function stickerWorldTransform(s: StickerInstance, tpl: CueTemplate, out: { pos: THREE.Vector3; quat: THREE.Quaternion; w: number; h: number }) {
  const PAD = 7;
  out.w = s.w + PAD;
  out.h = s.h + PAD;
  if (s.target.kind === 'lathe') {
    const seg = segmentById(tpl, s.target.segId);
    if (!seg) return false;
    const a = s.target.a;
    const ang = (s.target.angDeg * Math.PI) / 180;
    const r = radiusAtSeg(seg, a) + 0.6;
    out.pos.set(sceneX(tpl.lengthMm, a), r * Math.cos(ang), r * Math.sin(ang));
    const normal = new THREE.Vector3(
      -r * ((seg.r1 - seg.r0) / Math.max(1e-6, seg.a1 - seg.a0)),
      Math.cos(ang),
      Math.sin(ang)
    ).normalize();
    const around = new THREE.Vector3(0, -Math.sin(ang), Math.cos(ang));
    const along = new THREE.Vector3(1, 0, 0);
    out.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(around, along, normal));
    return true;
  }
  const face = faceById(tpl, s.target.faceId);
  if (!face) return false;
  if (face.id === 'face-butt') {
    const frame = bumperSurfaceFrame(face, s.target.fx, s.target.fz);
    out.pos.copy(frame.position).addScaledVector(frame.normal, 0.6);
    out.pos.x -= tpl.lengthMm / 2;
    out.quat.copy(frame.quaternion);
    return true;
  }
  out.pos.set(sceneX(tpl.lengthMm, face.a) + face.normalSign * 0.6, s.target.fx, s.target.fz);
  out.quat.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(face.normalSign, 0, 0)
    )
  );
  return true;
}

function StickerOverlay({ tpl }: { tpl: CueTemplate }) {
  const selection = useStore((s) => s.selection);
  const sticker = useStore((s) =>
    s.selection.kind === 'sticker' ? s.design.stickers.find((x) => x.id === s.selection.id) ?? null : null
  );
  const groupRef = useRef<THREE.Group>(null);
  const borderRef = useRef<SVGSVGElement>(null);
  const outlineRef = useRef<SVGPolygonElement>(null);
  const cornerRefs = useRef<(SVGCircleElement | null)[]>([]);
  const { size } = useThree();
  const tmp = useRef({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), w: 10, h: 10 });
  const corners = useMemo(() => Array.from({ length: 4 }, () => new THREE.Vector3()), []);

  useFrame(({ camera, size: viewport }) => {
    const g = groupRef.current;
    const border = borderRef.current;
    if (!g || !border) return;
    const visible = !!sticker && stickerWorldTransform(sticker, tpl, tmp.current);
    g.visible = visible;
    border.style.visibility = visible ? 'visible' : 'hidden';
    if (!visible || !sticker) return;
    g.position.copy(tmp.current.pos);
    g.quaternion.copy(tmp.current.quat);
    const { pos, quat, w, h } = tmp.current;
    let inFront = true;
    const points = corners.map((corner, i) => {
      corner.set((i === 0 || i === 3 ? -1 : 1) * w / 2, (i < 2 ? 1 : -1) * h / 2, 0)
        .applyQuaternion(quat).add(pos).project(camera);
      inFront &&= corner.z >= -1 && corner.z <= 1;
      const x = (corner.x + 1) * viewport.width / 2;
      const y = (1 - corner.y) * viewport.height / 2;
      cornerRefs.current[i]?.setAttribute('cx', String(x));
      cornerRefs.current[i]?.setAttribute('cy', String(y));
      return `${x},${y}`;
    });
    border.style.visibility = inFront ? 'visible' : 'hidden';
    outlineRef.current?.setAttribute('points', points.join(' '));
  });

  if (!sticker) return null;
  const upd = (patch: Partial<StickerInstance>) =>
    useStore.getState().updateSticker(sticker.id, patch, { noHistory: true });
  const commit = () => useStore.getState().pushHistory();

  return (
    <>
      <Html calculatePosition={overlayScreenOrigin} zIndexRange={[19, 19]} style={{ pointerEvents: 'none' }}>
        <svg ref={borderRef} width={size.width} height={size.height} aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <polygon ref={outlineRef} fill="none" stroke="#f5a623" strokeWidth={2}
            strokeDasharray="8 6" strokeLinejoin="round" />
          {[0, 1, 2, 3].map((i) => <circle key={i} ref={(node) => { cornerRefs.current[i] = node; }}
            r={4} fill="white" stroke="#f5a623" strokeWidth={1} />)}
        </svg>
      </Html>
      <group ref={groupRef}>
        <Html center zIndexRange={[18, 12]} position={[0, 0, 0]} style={{ pointerEvents: 'none' }}>
          <div
            className="sticker-toolbar"
            style={{ transform: 'translate(-50%, -140%)', pointerEvents: 'auto' }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <OvBtn label="⟲90°" title="左旋 90°" onClick={() => { commit(); upd({ rotDeg: sticker.rotDeg - 90 }); }} />
            <OvBtn label="⟳90°" title="右旋 90°" onClick={() => { commit(); upd({ rotDeg: sticker.rotDeg + 90 }); }} />
            <OvBtn label="放大" title="放大 10%" onClick={() => { commit(); upd({ w: sticker.w * 1.1, h: sticker.h * 1.1 }); }} />
            <OvBtn label="缩小" title="缩小 10%" onClick={() => { commit(); upd({ w: sticker.w / 1.1, h: sticker.h / 1.1 }); }} />
            <OvBtn label="复制" title="复制贴纸" onClick={() => useStore.getState().duplicateSticker(sticker.id)} />
            <OvBtn label="删除" title="删除贴纸" danger onClick={() => useStore.getState().removeSticker(sticker.id)} />
          </div>
        </Html>
      </group>
    </>
  );
}

function OvBtn({ label, title, onClick, danger }: { label: string; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`sticker-toolbar-button${danger ? ' is-danger' : ''}`}
    >
      {label}
    </button>
  );
}

function updateGhost(hit: SurfaceHit, tpl: CueTemplate) {
  ghostState.w = DEFAULT_STICKER_W;
  if (hit.kind === 'lathe') {
    const seg = segmentById(tpl, hit.surfaceId);
    if (!seg) return;
    const a = hit.a!;
    const ang = (hit.angDeg! * Math.PI) / 180;
    const r = radiusAtSeg(seg, a);
    ghostState.pos.set(sceneX(tpl.lengthMm, a), r * Math.cos(ang), r * Math.sin(ang));
    const normal = new THREE.Vector3(
      -r * ((seg.r1 - seg.r0) / Math.max(1e-6, seg.a1 - seg.a0)),
      Math.cos(ang),
      Math.sin(ang)
    ).normalize();
    const around = new THREE.Vector3(0, -Math.sin(ang), Math.cos(ang));
    const along = new THREE.Vector3(1, 0, 0);
    ghostState.quat.setFromRotationMatrix(new THREE.Matrix4().makeBasis(around, along, normal));
    ghostState.active = true;
  } else {
    const face = faceById(tpl, hit.surfaceId);
    if (!face) return;
    if (face.id === 'face-butt') {
      const frame = bumperSurfaceFrame(face, hit.fx ?? 0, hit.fz ?? 0);
      ghostState.pos.copy(frame.position).addScaledVector(frame.normal, 0.6);
      ghostState.pos.x -= tpl.lengthMm / 2;
      ghostState.quat.copy(frame.quaternion);
      ghostState.active = true;
      return;
    }
    ghostState.pos.set(sceneX(tpl.lengthMm, face.a), hit.fx ?? 0, hit.fz ?? 0);
    ghostState.quat.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(face.normalSign, 0, 0)
      )
    );
    ghostState.active = true;
  }
}

async function placeSticker(hit: SurfaceHit, assetId: string, tpl: CueTemplate) {
  const st = useStore.getState();
  const asset = st.assets.find((a) => a.id === assetId);
  if (!asset) return;
  const aspect = asset.h / asset.w;
  const w = DEFAULT_STICKER_W;
  const h = w * aspect;
  const z = st.design.stickers.reduce((m, s) => Math.max(m, s.z), 0) + 1;
  let target: StickerInstance['target'];
  if (hit.kind === 'lathe') {
    const seg = segmentById(tpl, hit.surfaceId);
    if (!seg) return;
    if (!seg.printEnabled) {
      st.showToast('皮头端不参与印刷，请选择其他表面');
      return;
    }
    target = { kind: 'lathe', segId: seg.id, a: Math.min(seg.a1, Math.max(seg.a0, hit.a!)), angDeg: hit.angDeg! };
  } else {
    const face = faceById(tpl, hit.surfaceId);
    if (!face) return;
    if (!face.printEnabled) {
      st.showToast('该端面不参与印刷');
      return;
    }
    target = { kind: 'face', faceId: face.id, fx: hit.fx ?? 0, fz: hit.fz ?? 0 };
  }
  const instance: StickerInstance = {
    id: nextStickerId(),
    name: (asset.name || '贴纸').slice(0, 12),
    assetId,
    processedRev: 0,
    target,
    w,
    h,
    rotDeg: 0,
    flipX: false,
    flipY: false,
    opacity: 1,
    z,
    hidden: false,
    locked: false
  };
  st.addSticker(instance);
  await getStickerImage(instance);
  if (useStore.getState().interactionMode === 'watch') return;
  st.select({ kind: 'sticker', id: instance.id });
  st.setPlacementAsset(null);
}

// —— 材质高亮辅助 ——

function applyEmissive(handle: CueMaterialHandle | null, level: 'none' | 'hover' | 'selected') {
  const mat = handle?.material;
  if (!mat) return;
  if (level === 'selected') mat.emissive.set('#4a3510');
  else if (level === 'hover') mat.emissive.set('#232019');
  else mat.emissive.set('#000000');
}

/** 选中描边：略放大的背面壳（inverted hull），沿部件轮廓露出细边 */
function useOutlineMaterial() {
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#f5a623',
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.9,
        toneMapped: false
      }),
    []
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return mat;
}

/** 部件名称牌 + 描边（选中时） */
function PartSelectionFx({
  partId,
  tpl,
  outlineGeometry,
  kind
}: {
  partId: string;
  tpl: CueTemplate;
  outlineGeometry?: THREE.BufferGeometry;
  kind: 'lathe' | 'face';
}) {
  const outlineMat = useOutlineMaterial();
  const selected = useStore((s) => s.selection.kind === 'part' && s.selection.id === partId);
  if (!selected) return null;
  const seg = kind === 'lathe' ? expandedSegments(tpl).find((s) => s.id === partId) : null;
  const face = kind === 'face' ? tpl.faces.find((f) => f.id === partId) : null;
  const mid = seg ? (seg.a0 + seg.a1) / 2 : face ? face.a : 0;
  const rMid = seg ? (seg.r0 + seg.r1) / 2 : face ? face.radius : 0;
  const label = seg?.name ?? face?.name ?? '';
  const anchor: [number, number, number] =
    kind === 'face' && face
      ? [sceneX(tpl.lengthMm, face.a) + face.normalSign * 4, 0, face.radius + 4]
      : [sceneX(tpl.lengthMm, mid), rMid + 3, 0];
  return (
    <>
      {kind === 'lathe' && outlineGeometry && (
        <mesh geometry={outlineGeometry} material={outlineMat} renderOrder={4} />
      )}
      {kind === 'face' && face && (
        <FaceOutline radius={face.radius} normalSign={face.normalSign} x={sceneX(tpl.lengthMm, face.a)} />
      )}
      <Html position={anchor} center distanceFactor={340} zIndexRange={[16, 10]} pointerEvents="none">
        <div className="whitespace-nowrap rounded-full border-2 border-accent-500 bg-ink-950/95 px-4 py-1.5 text-sm font-semibold text-accent-400 shadow-2xl">
          {label}
        </div>
      </Html>
    </>
  );
}

/** 端面描边圆环 */
function FaceOutline({ radius, normalSign, x }: { radius: number; normalSign: 1 | -1; x: number }) {
  const mat = useOutlineMaterial();
  const geom = useMemo(() => {
    const g = new THREE.RingGeometry(radius * 0.985, radius + 1.0, 64);
    g.rotateY((normalSign * Math.PI) / 2);
    return g;
  }, [radius, normalSign]);
  useEffect(() => () => geom.dispose(), [geom]);
  return <mesh geometry={geom} material={mat} position={[x + normalSign * 0.4, 0, 0]} renderOrder={4} />;
}

// —— 旋转体部件 ——

function CuePart({
  seg,
  totalLen,
  tpl
}: {
  seg: SegmentSpec;
  totalLen: number;
  tpl: CueTemplate;
}) {
  const startup = useContext(StartupContext);
  const gl = useThree((s) => s.gl);
  const geom = useMemo(() => {
    const g = buildDisplaySegmentGeometry(seg);
    g.translate(-totalLen / 2, 0, 0);
    return g;
  }, [seg, totalLen]);
  useEffect(() => () => geom.dispose(), [geom]);

  const outlineGeom = useMemo(() => {
    const g = buildSegmentGeometry({ ...seg, a0: seg.a0 - 2, a1: seg.a1 + 2, r0: seg.r0 + 1.1, r1: seg.r1 + 1.1 });
    g.translate(-totalLen / 2, 0, 0);
    return g;
  }, [seg, totalLen]);
  useEffect(() => () => outlineGeom.dispose(), [outlineGeom]);

  const design = useStore((s) => s.design);
  const quality = useStore((s) => s.quality);
  const interactive = useStore((s) => s.interactive);
  const whiteModel = useStore((s) => s.showWhiteModel);
  const exportCheckMode = useStore((s) => s.exportCheckMode);
  const exportCheckData = useStore((s) => s.exportCheckData);
  const override = ringOverride(seg.id, design.partOverrides);
  const finishId = override?.finish ?? design.globalFinish;
  const presetId = whiteModel ? 'whiteSolid' : override?.matPreset ?? seg.matPreset;

  const [handle, setHandle] = useState<CueMaterialHandle | null>(null);
  useEffect(() => {
    const h = createCueMaterial({
      preset: presetById(presetId),
      finishId,
      colorOverride: whiteModel ? '#d8d8d8' : override?.color,
      circMm: 2 * Math.PI * ((seg.r0 + seg.r1) / 2),
      lenMm: seg.a1 - seg.a0,
      axialOriginMm: seg.a0,
      partKind: seg.kind
    });
    setHandle(h);
    const complete = startup?.begin();
    void h.ready.finally(complete);
    return () => { complete?.(); h.dispose(); };
  }, [presetId, finishId, override?.color, seg.r0, seg.r1, seg.a0, seg.a1, seg.kind, whiteModel]);

  // 印刷层合成（plan §4.3：拖动时轻量，停止后清晰）
  useEffect(() => {
    if (!handle) return;
    let dead = false;
    let tex: THREE.CanvasTexture | null = null;
    const complete = startup?.begin();
    (async () => {
      const stickers = design.stickers.filter((s) => stickerOverlapsSegment(s, seg));
      await Promise.all(stickers.map(getStickerImage));
      if (dead) return;
      let canvas: HTMLCanvasElement | null = null;
      if (exportCheckMode && exportCheckData) {
        canvas = checkCanvasFor(seg, exportCheckData);
      } else if (seg.printEnabled && stickers.length) {
        const { ppm, maxDim } = previewPrintResolution(
          Math.PI * (seg.r0 + seg.r1), seg.a1 - seg.a0, stickers,
          getCachedStickerImage, quality, interactive, gl.capabilities.maxTextureSize,
        );
        canvas = composeSegmentPrint(seg, stickers, ppm, maxDim, expandedSegments(tpl)).canvas;
      }
      if (!canvas) { handle.setPrintMap(null); return; }
      if (dead) return;
      tex = canvasToTexture(canvas, gl.capabilities.getMaxAnisotropy());
      handle.setPrintMap(tex);
    })().catch((error) => console.warn('图案预览暂用底材：', error)).finally(complete);
    return () => {
      dead = true;
      complete?.();
      tex?.dispose();
    };
  }, [handle, design.stickers, quality, interactive, gl, seg, tpl, exportCheckMode, exportCheckData]);

  const selection = useStore((s) => s.selection);
  const hoverId = useStore((s) => s.hoverId);
  useEffect(() => {
    const level =
      selection.kind === 'part' && selection.id === seg.id
        ? 'selected'
        : hoverId === seg.id
          ? 'hover'
          : 'none';
    applyEmissive(handle, level);
  }, [handle, selection, hoverId, seg.id]);

  return (
    <>
      <mesh
        geometry={geom}
        userData={{ surfaceKind: 'lathe', segId: seg.id, materialReady: !!handle }}
        castShadow
        receiveShadow
      >
        {handle ? <primitive object={handle.material} attach="material" /> : null}
      </mesh>
      <PartSelectionFx partId={seg.id} tpl={tpl} outlineGeometry={outlineGeom} kind="lathe" />
    </>
  );
}

// —— 端面 ——

function CueFace({
  face,
  totalLen,
  tpl
}: {
  face: FaceSpec;
  totalLen: number;
  tpl: CueTemplate;
}) {
  const startup = useContext(StartupContext);
  const gl = useThree((s) => s.gl);
  const geom = useMemo(() => {
    const g = buildDisplayFaceGeometry(face);
    g.translate(-totalLen / 2, 0, 0);
    return g;
  }, [face, totalLen]);
  useEffect(() => () => geom.dispose(), [geom]);

  const design = useStore((s) => s.design);
  const quality = useStore((s) => s.quality);
  const interactive = useStore((s) => s.interactive);
  const whiteModel = useStore((s) => s.showWhiteModel);
  const appearance = partAppearance(tpl, face.id, design.partOverrides);
  const override = appearance.override;
  const finishId = override?.finish ?? design.globalFinish;
  const presetId = whiteModel ? 'whiteSolid' : appearance.presetId ?? face.matPreset;

  const [handle, setHandle] = useState<CueMaterialHandle | null>(null);
  useEffect(() => {
    const h = createCueMaterial({
      preset: presetById(presetId),
      finishId,
      colorOverride: whiteModel ? '#d8d8d8' : override?.color,
      circMm: face.radius * 2,
      lenMm: face.radius * 2,
      surface: 'face',
      partKind: face.id === 'face-butt' ? 'butt' : undefined
    });
    setHandle(h);
    const complete = startup?.begin();
    void h.ready.finally(complete);
    return () => { complete?.(); h.dispose(); };
  }, [presetId, finishId, override?.color, face.radius, whiteModel]);

  useEffect(() => {
    if (!handle) return;
    let dead = false;
    let tex: THREE.CanvasTexture | null = null;
    const complete = startup?.begin();
    (async () => {
      const stickers = design.stickers.filter((s) => !s.hidden && s.target.kind === 'face' && s.target.faceId === face.id);
      await Promise.all(stickers.map(getStickerImage));
      if (dead) return;
      let canvas: HTMLCanvasElement | null = null;
      if (face.printEnabled && stickers.length) {
        const { ppm, maxDim } = previewPrintResolution(
          face.radius * 2, face.radius * 2, stickers,
          getCachedStickerImage, quality, interactive, gl.capabilities.maxTextureSize,
        );
        canvas = composeFacePrint(face, stickers, ppm, maxDim).canvas;
      }
      if (!canvas) { handle.setPrintMap(null); return; }
      if (dead) return;
      tex = canvasToTexture(canvas, gl.capabilities.getMaxAnisotropy());
      handle.setPrintMap(tex);
    })().catch((error) => console.warn('端面图案预览暂用底材：', error)).finally(complete);
    return () => {
      dead = true;
      complete?.();
      tex?.dispose();
    };
  }, [handle, design.stickers, interactive, quality, gl, face]);

  useEffect(() => {
    if (!handle || face.id !== 'face-butt') return;
    const strip = tailPrintSegment(tpl);
    if (!strip) return;
    let dead = false;
    let texture: THREE.CanvasTexture | null = null;
    const complete = startup?.begin();
    const stickers = design.stickers.filter((sticker) => stickerOverlapsSegment(sticker, strip));
    void (async () => {
      await Promise.all(stickers.map(getStickerImage));
      if (dead) return;
      if (!stickers.length) { handle.setContinuationMap(null); return; }
      const { ppm, maxDim } = previewPrintResolution(2 * Math.PI * strip.r0, strip.a1 - strip.a0, stickers, getCachedStickerImage, quality, interactive, gl.capabilities.maxTextureSize);
      texture = canvasToTexture(composeSegmentPrint(strip, stickers, ppm, maxDim, expandedSegments(tpl)).canvas, gl.capabilities.getMaxAnisotropy());
      handle.setContinuationMap(texture);
    })().catch((error) => console.warn('尾端图案预览暂用底材：', error)).finally(complete);
    return () => { dead = true; complete?.(); texture?.dispose(); };
  }, [handle, face.id, tpl, design.stickers, quality, interactive, gl]);

  const selection = useStore((s) => s.selection);
  const hoverId = useStore((s) => s.hoverId);
  useEffect(() => {
    const level =
      selection.kind === 'part' && selection.id === appearance.partId
        ? 'selected'
        : hoverId === appearance.partId
          ? 'hover'
          : 'none';
    applyEmissive(handle, level);
  }, [handle, selection, hoverId, appearance.partId]);

  return (
    <>
      <mesh geometry={geom} userData={{ surfaceKind: 'face', faceId: face.id, materialReady: !!handle }} castShadow>
        {handle ? <primitive object={handle.material} attach="material" /> : null}
      </mesh>
      {face.id !== 'face-butt' && <PartSelectionFx partId={face.id} tpl={tpl} kind="face" />}
    </>
  );
}

/** 回贴检查：按块把导出 PNG 还原为部件印刷画布（与合成同一映射的逆过程，plan §7.3） */
function checkCanvasFor(
  seg: SegmentSpec,
  data: NonNullable<ReturnType<typeof useStore.getState>['exportCheckData']>
): HTMLCanvasElement | null {
  const len = seg.a1 - seg.a0;
  if (len <= 0) return null;
  const rMid = (seg.r0 + seg.r1) / 2;
  const ppm = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.round(2 * Math.PI * rMid * ppm));
  canvas.height = Math.max(4, Math.round(len * ppm));
  const ctx = canvas.getContext('2d')!;
  let found = false;
  for (const b of data.blocks) {
    if (b.block.segId !== seg.id) continue;
    found = true;
    const destY = (b.block.a0 - seg.a0) * ppm;
    const destH = Math.max(1, (b.block.a1 - b.block.a0) * ppm);
    ctx.drawImage(data.canvas, b.sx, b.sy, b.sw, b.sh, 0, destY, canvas.width, destH);
  }
  return found ? canvas : null;
}

// —— 部件组与交互 ——

function CueGroup({ tpl }: { tpl: CueTemplate }) {
  const scene = useThree((s) => s.scene);
  const dragRef = useRef<{ id: string; dx: number; dy: number; snapshot: DesignSnapshot } | null>(null);
  const { camera, gl, raycaster, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    gl: { domElement: HTMLCanvasElement };
    raycaster: THREE.Raycaster;
    controls: { enabled: boolean } | null;
  };

  const alphaGetter = (s: StickerInstance, lx: number, ly: number) => {
    const img = getCachedStickerImage(s);
    return stickerAlphaAt(img, s, lx, ly);
  };

  const raycastCue = (ndc: THREE.Vector2): Intersection[] => {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    return hits.filter(
      (h) => h.uv && (h.object.userData.segId || h.object.userData.faceId)
    ) as Intersection[];
  };

  // 贴纸拖动：窗口级事件 + 手动射线（拖动时相机不动，plan §3.4）
  useEffect(() => {
    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || useStore.getState().interactionMode === 'watch') return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1
      );
      const first = raycastCue(ndc)[0];
      if (!first) return;
      const st = useStore.getState();
      const s = st.design.stickers.find((x) => x.id === drag.id);
      if (!s) return;
      const hit = surfaceFromIntersection(first, tpl);
      if (!hit) return;
      const moved = moveStickerTo(s, hit, { dx: drag.dx, dy: drag.dy }, tpl);
      if (moved) st.updateSticker(s.id, { target: moved.target }, { noHistory: true });
    };
    const onUp = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (controls) controls.enabled = true;
      useStore.getState().set({ interactive: false });
      // 一次完整拖动记作一次撤销（plan §3.4）
      if (drag) useStore.getState().commitSnapshot(drag.snapshot);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [camera, gl, raycaster, controls, tpl]);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    const st = useStore.getState();
    if (st.interactionMode === 'watch') return;
    e.stopPropagation();
    const hit = surfaceFromIntersection(e, tpl);
    if (!hit) return;

    if (st.placementAssetId) {
      void placeSticker(hit, st.placementAssetId, tpl);
      return;
    }

    const hitSticker = pickSticker([hit], st.design.stickers, tpl, alphaGetter);
    if (hitSticker) {
      st.select({ kind: 'sticker', id: hitSticker.id });
      if (hitSticker.locked) return;
      const c = stickerCanvasCenter(hitSticker, tpl);
      let dx = 0;
      let dy = 0;
      if (hit.kind === 'lathe' && hitSticker.target.kind === 'lathe') {
        const seg = segmentById(tpl, hitSticker.target.segId);
        if (!seg) return;
        const r = radiusAtSeg(seg, hitSticker.target.a);
        dx = (angDelta(hit.angDeg!, hitSticker.target.angDeg) / 360) * 2 * Math.PI * r;
        dy = hit.a! - hitSticker.target.a;
      } else if (hit.kind === 'face' && hitSticker.target.kind === 'face') {
        dx = hit.x - c.x;
        dy = hit.y - c.y;
      }
      dragRef.current = { id: hitSticker.id, dx, dy, snapshot: st.design };
      if (controls) controls.enabled = false;
      useStore.getState().set({ interactive: true });
      return;
    }
    st.select({ kind: 'part', id: hit.surfaceId });
  };

  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const st = useStore.getState();
    if (st.interactionMode === 'watch') { ghostState.active = false; return; }
    const hit = surfaceFromIntersection(e, tpl);
    if (!hit) {
      ghostState.active = false;
      return;
    }
    if (st.placementAssetId) {
      updateGhost(hit, tpl);
      return;
    }
    ghostState.active = false;
    const hitSticker = pickSticker([hit], st.design.stickers, tpl, alphaGetter);
    const hoverId = hitSticker ? hitSticker.id : appearancePartId(hit.surfaceId);
    if (st.hoverId !== hoverId) st.set({ hoverId });
  };

  const parts = useMemo(() => expandedSegments(tpl), [tpl]);

  return (
    <group
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onDoubleClick={(e: ThreeEvent<MouseEvent>) => {
        if (useStore.getState().interactionMode === 'watch') return;
        const hit = surfaceFromIntersection(e, tpl);
        if (hit) useStore.getState().focusPart(hit.surfaceId);
      }}
      onPointerOut={() => {
        ghostState.active = false;
        useStore.getState().set({ hoverId: null });
      }}
    >
      {parts.map((seg) => (
        <CuePart key={seg.id} seg={seg} totalLen={tpl.lengthMm} tpl={tpl} />
      ))}
      {tpl.faces.map((f) => (
        <CueFace key={f.id} face={f} totalLen={tpl.lengthMm} tpl={tpl} />
      ))}
    </group>
  );
}

// —— 相机视角 ——

/** 取景方向（俯视约 17°、方位约 -20°），全程固定，距离按部件尺寸计算 */
const VIEW_DIR = new THREE.Vector3(0.38, 0.34, 0.86).normalize();

function CameraRig({ tpl, ready }: { tpl: CueTemplate; ready: boolean }) {
  const { camera, controls, size } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera;
    controls: OrbitControlsImpl | null;
    size: { width: number; height: number };
  };
  const watching = useStore((s) => s.interactionMode === 'watch');
  const view = useStore((s) => s.view);
  const focusPartId = useStore((s) => s.focusPartId);
  const viewNonce = useStore((s) => s.viewNonce);
  const goal = useRef({ pos: new THREE.Vector3(), target: new THREE.Vector3() });
  const animating = useRef(false);
  const userControlled = useRef(false);

  useEffect(() => {
    const takeControl = () => { animating.current = false; userControlled.current = true; };
    controls?.addEventListener('start', takeControl);
    return () => controls?.removeEventListener('start', takeControl);
  }, [controls]);

  useEffect(() => {
    userControlled.current = false;
    camera.clearViewOffset();
  }, [camera, watching, view, focusPartId, viewNonce, tpl]);

  useEffect(() => {
    if (!watching || !controls) return;
    return bindCueAxisSnap(controls, tpl.lengthMm);
  }, [watching, controls, tpl.lengthMm, view, focusPartId, viewNonce]);

  // Preserve the manually chosen axial pivot until an explicit framing request.
  useEffect(() => {
    if ((watching || view === 'whole') && userControlled.current) return;
    const L = tpl.lengthMm;
    const x = (a: number) => sceneX(L, a);
    const aspect = Math.max(0.8, size.width / Math.max(1, size.height));
    const tanH = Math.tan((30 * Math.PI) / 180 / 2);
    /** 给定希望占画面水平比例的毫米宽度，求相机距离 */
    const distFor = (spanMm: number, ratio: number) =>
      Math.min(3200, Math.max(120, spanMm / ratio / (2 * tanH * aspect)));

    const segs = expandedSegments(tpl);
    const joint = segs.find((s) => s.id === 'joint');
    const buttStart = tpl.shaftLengthMm;

    let target: THREE.Vector3;
    let dist: number;
    if (view === 'focus' && focusPartId) {
      const seg = segs.find((s) => s.id === focusPartId) ?? expandedSegments(resolveTemplate(tpl.id)).find((s) => s.id === focusPartId);
      const face = tpl.faces.find((f) => f.id === focusPartId);
      if (seg) {
        const len = Math.max(seg.a1 - seg.a0, 10);
        target = new THREE.Vector3(x((seg.a0 + seg.a1) / 2), 0, 0);
        dist = partFocusDistance(len * 2.2, aspect, camera.fov);
      } else if (face) {
        target = new THREE.Vector3(x(face.a), 0, 0);
        dist = partFocusDistance(face.radius * 5.5, aspect, camera.fov);
      } else {
        target = new THREE.Vector3(0, 0, 0);
        dist = distFor(L, 0.94);
      }
    } else if (view === 'butt') {
      // 保留两端余量，窄预览面板中也能完整看到后把。
      target = new THREE.Vector3(x((buttStart + L) / 2), 0, 0);
      dist = distFor(L - buttStart, 0.80);
    } else if (view === 'shaft') {
      const shaft = segs.find((s) => s.id === 'shaft');
      const s0 = shaft ? shaft.a0 : 0;
      const s1 = shaft ? shaft.a1 : L * 0.5;
      target = new THREE.Vector3(x((s0 + s1) / 2), 0, 0);
      dist = distFor(s1 - s0, 0.80);
    } else if (view === 'joint') {
      const jx = joint ? (joint.a0 + joint.a1) / 2 : L / 2;
      target = new THREE.Vector3(x(jx), 0, 0);
      dist = partFocusDistance(90 / 0.5, aspect, camera.fov);
    } else if (view === 'face') {
      target = new THREE.Vector3(x(L), 0, 0);
      dist = partFocusDistance(80 / 0.5, aspect, camera.fov);
    } else {
      target = new THREE.Vector3(0, 0, 0);
      dist = distFor(L, 0.94);
    }
    goal.current = {
      pos: target.clone().addScaledVector(VIEW_DIR, dist),
      target
    };
    animating.current = true;
  }, [watching, view, focusPartId, viewNonce, tpl, size.width, size.height]);

  useFrame(() => {
    if (!ready || !animating.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      camera.position.copy(goal.current.pos);
      controls?.target.copy(goal.current.target);
      controls?.update();
      animating.current = false;
      return;
    }
    camera.position.lerp(goal.current.pos, 0.12);
    if (controls) {
      controls.target.lerp(goal.current.target, 0.12);
      controls.update();
    }
    if (camera.position.distanceTo(goal.current.pos) < 1.2) animating.current = false;
  });
  return null;
}

function FpsMeter() {
  const acc = useRef({ frames: 0, t0: performance.now() });
  useFrame(() => {
    const a = acc.current;
    a.frames++;
    const now = performance.now();
    if (now - a.t0 > 600) {
      const fps = Math.round((a.frames * 1000) / (now - a.t0));
      a.frames = 0;
      a.t0 = now;
      if (useStore.getState().fps !== fps) useStore.setState({ fps });
    }
  });
  return null;
}

function StartupWarmup({ startup, onReady }: { startup: SceneStartup; onReady: () => void }) {
  const { gl, scene, camera } = useThree();
  const running = useRef(false);
  const alive = useRef(true);
  const frames = useRef<(() => void)[]>([]);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      frames.current.splice(0).forEach((resolve) => resolve());
    };
  }, []);
  useFrame(() => {
    frames.current.splice(0).forEach((resolve) => resolve());
    if (running.current || startup.released || startup.pending || !scene.environment) return;
    let count = 0;
    let mounted = true;
    const surfaces: THREE.Object3D[] = [];
    scene.traverse((object) => {
      if (!object.userData.surfaceKind) return;
      count++;
      mounted &&= object.userData.materialReady === true;
      surfaces.push(object);
    });
    if (!count || !mounted) return;
    running.current = true;
    // Warm every cue part, even those outside the opening camera's first view.
    // Otherwise the moving camera would trigger their first texture/buffer upload.
    const culling = surfaces.map((object) => object.frustumCulled);
    surfaces.forEach((object) => { object.frustumCulled = false; });
    void prepareSceneStartup(startup,
      () => gl.compileAsync(scene, camera).catch((error) => {
        console.warn('场景异步预编译不可用，改用同步预编译：', error);
        gl.compile(scene, camera);
      }),
      () => new Promise<void>((resolve) => frames.current.push(resolve)),
      () => gl.getContext().finish(),
      () => alive.current && !gl.getContext().isContextLost(),
    ).then((prepared) => {
      if (!prepared) return;
      startup.released = true;
      onReadyRef.current();
    }).catch((error) => {
      console.warn('场景预编译失败，将在遮罩后重试：', error);
    }).finally(() => {
      surfaces.forEach((object, index) => { object.frustumCulled = culling[index]; });
      running.current = false;
    });
  }, -100);
  return null;
}

// Keep the generated environment stable when the loading mask is removed.
// Re-capturing it would move PMREM generation back into the first camera frame.
const StudioEnvironment = memo(function StudioEnvironment() {
  return <Environment resolution={512}>
    <Lightformer form="rect" intensity={2.6} color="#fff8ef" position={[0, 360, 300]} scale={[1300, 210, 1]} />
    <Lightformer form="rect" intensity={1.4} color="#f1f5fa" position={[0, 80, -420]} scale={[1250, 46, 1]} />
    <Lightformer form="rect" intensity={0.45} position={[-260, -110, 400]} scale={[900, 260, 1]} />
    <Lightformer form="rect" intensity={0.22} color="#ddd5c8" position={[0, -360, 0]} scale={[1400, 500, 1]} />
    <Lightformer form="rect" intensity={0.8} color="#fff8ef" position={[1300, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={[350, 350, 1]} />
    <Lightformer form="rect" intensity={0.6} color="#edf2f5" position={[-1300, 0, 0]} rotation={[0, Math.PI / 2, 0]} scale={[350, 350, 1]} />
  </Environment>;
});

export function CueScene({ tpl, onReady }: { tpl: CueTemplate; onReady?: () => void }) {
  const startup = useMemo(() => new SceneStartup(), []);
  const [ready, setReady] = useState(false);
  const bgMode = useStore((s) => s.bgMode);
  const watching = useStore((s) => s.interactionMode === 'watch');
  const wholeView = useStore((s) => s.view === 'whole' || s.interactionMode === 'watch');
  return (
    <StartupContext.Provider value={startup}><Canvas
      shadows
      dpr={[1, 2]}
      camera={{ fov: 30, position: [320, 230, 760], near: 1, far: 30000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace }}
      onCreated={(state) => {
        photoSource.current = { scene: state.scene, camera: state.camera, renderer: state.gl };
        void import('../export/exportPng').then((m) => {
          m.glRef.current = state.gl;
        });
        if (import.meta.env.DEV) {
          (window as unknown as { __cueScene: unknown }).__cueScene = state.scene;
        }
      }}
      onPointerMissed={() => {
        const st = useStore.getState();
        if (st.interactionMode === 'watch') return;
        if (!st.placementAssetId) st.select({ kind: 'global' });
        st.set({ hoverId: null });
      }}
    >
      <color attach="background" args={[BG_COLORS[bgMode]]} />
      <ambientLight intensity={0.08} />
      <hemisphereLight intensity={0.16} color="#f4f3ed" groundColor="#514b43" />
      <directionalLight position={[280, 650, 480]} intensity={0.65} color="#fff8ef" />
      <directionalLight position={[-400, 160, -380]} intensity={0.18} color="#edf2f5" />
      {/* Axial fill keeps both end faces lit when looking along the cue. */}
      <directionalLight position={[1600, 360, 520]} intensity={0.35} color="#fff8ef" />
      <directionalLight position={[-1500, 240, 400]} intensity={0.25} color="#edf2f5" />
      <StudioEnvironment />
      <CueGroup tpl={tpl} />
      {!watching && <GhostSticker />}
      {!watching && <StickerOverlay tpl={tpl} />}
      <ContactShadows position={[0, -26, 0]} scale={1900} blur={2.4} opacity={0.25} far={120} />
      <OrbitControls
        makeDefault
        enableDamping
        rotateSpeed={0.35}
        dampingFactor={0.12}
        enablePan={wholeView}
        screenSpacePanning
        minDistance={wholeView ? 0 : 60}
        maxDistance={wholeView ? Infinity : 2800}
        minPolarAngle={wholeView ? 0 : 0.25}
        maxPolarAngle={wholeView ? Math.PI : Math.PI / 1.75}
      />
      <StartupWarmup startup={startup} onReady={() => { setReady(true); onReady?.(); }} />
      <CameraRig tpl={tpl} ready={ready} />
      {import.meta.env.DEV && <FpsMeter />}
    </Canvas></StartupContext.Provider>
  );
}
