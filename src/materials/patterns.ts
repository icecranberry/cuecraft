import type { Asset } from '../core/types';
import catalog from './patterns.json';
import stickerCatalog from './stickers.json';

export type AssetKindFilter = 'all' | 'pattern' | 'sticker';
type CatalogEntry = {
  id: string; name: string; category: string; tags: string[];
  description: string; w: number; h: number;
};

/** Stable IDs keep saved designs linked to the bundled originals across releases. */
const bundledAssets = (entries: CatalogEntry[], kind: 'pattern' | 'sticker'): Asset[] => entries.map((pattern) => ({
  ...pattern,
  kind,
  id: `builtin-${pattern.id}`,
  blobKey: `blob:builtin-${pattern.id}`,
  source: 'builtin',
  createdAt: Date.UTC(2026, 9, 3),
}));

export const BUILTIN_PATTERNS = bundledAssets(catalog, 'pattern');
export const BUILTIN_STICKERS = bundledAssets(stickerCatalog, 'sticker');
export const BUILTIN_ASSETS = [...BUILTIN_PATTERNS, ...BUILTIN_STICKERS];
export const PATTERN_CATEGORIES = [...new Set(catalog.map((p) => p.category))];
export function builtinCategories(kind: AssetKindFilter = 'all'): string[] {
  return [...new Set(BUILTIN_ASSETS.filter((a) => kind === 'all' || a.kind === kind).map((a) => a.category!))];
}
const urls = new Map<string, string>([
  ...catalog.map((p) => [
  `blob:builtin-${p.id}`, `${import.meta.env.BASE_URL}patterns/${p.id}.png`,
  ] as const),
  ...(stickerCatalog as CatalogEntry[]).map((p) => [
    `blob:builtin-${p.id}`, `${import.meta.env.BASE_URL}stickers/${p.id}.png`,
  ] as const),
]);

export function builtinPatternUrl(key: string): string | undefined {
  return urls.get(key);
}

/** Refresh the shipped catalog without duplicating or changing personal images. */
export function mergeBuiltinPatterns(saved: Asset[]): Asset[] {
  const ids = new Set(BUILTIN_ASSETS.map((p) => p.id));
  return [...BUILTIN_ASSETS, ...saved.filter((a) => !ids.has(a.id))];
}

export function filterAssets(assets: Asset[], query = '', source = 'all', category = 'all', kind: AssetKindFilter = 'all'): Asset[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return assets.filter((a) => !a.removed &&
    (source === 'all' || a.source === source) &&
    (category === 'all' || a.category === category) &&
    (kind === 'all' || a.kind === kind) &&
    terms.every((term) => [a.name, a.category, a.description, ...a.tags].filter(Boolean).join(' ').toLocaleLowerCase().includes(term)));
}
