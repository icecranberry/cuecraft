import { useStore, nextStickerId } from './store';
import { loadImage } from './imageStore';
import { glRef } from '../export/exportPng';
import type { Asset } from '../core/types';

export async function uploadDesignImages(files: FileList | File[]): Promise<Asset[]> {
  const added: Asset[] = [];
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue;
    const url = URL.createObjectURL(file);
    let image: HTMLImageElement;
    try { image = await loadImage(url); } finally { URL.revokeObjectURL(url); }
    const id = nextStickerId().replace('st-', 'as-');
    const asset: Asset = { id, name: file.name.replace(/\.[^.]+$/, '').slice(0, 40), source: 'upload', tags: [],
      w: image.naturalWidth, h: image.naturalHeight, blobKey: `blob:${id}`, createdAt: Date.now() };
    useStore.getState().addAsset(asset, file);
    added.push(asset);
  }
  if (!added.length) throw new Error('请选择 JPG、PNG 或其他图片文件');
  return added;
}

export function saveCurrentProduct() {
  const st = useStore.getState();
  let cover: string | undefined;
  try { cover = glRef.current?.domElement.toDataURL('image/jpeg', 0.8); } catch { /* 仍可保存设计 */ }
  const name = !st.design.name.trim() || st.design.name === '未命名设计' ? '我的球杆设计' : st.design.name.trim();
  const version = st.saveVersion(name, '保存设计', cover);
  st.addProduct({ id: `prod-${nextStickerId()}`, name, desc: '', cover, versionId: version.id, createdAt: Date.now() });
  st.showToast('设计已保存到「我的作品」');
}
