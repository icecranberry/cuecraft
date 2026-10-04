import { listCueAssets, listCueSkus } from '@/apis/cue_api'
import { templateFromSpecification } from './bridge'

/** Add the selected catalog geometry to an AI proposal before preview or editing. */
export async function hydrateProposalSnapshot(snapshot) {
  const hydrated = structuredClone(snapshot)
  if (hydrated.blankAssetId) {
    const blanks = await listCueAssets('blank')
    const blank = blanks.find((item) => item.id === hydrated.blankAssetId)
    if (!blank) throw new Error('方案引用的光杆素材已不存在')
    const template = templateFromSpecification(blank.specification || {}, blank.name)
    template.sizeStatus = '用户指定尺寸'
    template.sizeSource = blank.source === 'ai' ? 'AI 尺寸草案' : '素材库尺寸'
    hydrated.cueTemplateId = template.id
    hydrated.cueTemplate = template
  } else if (hydrated.sourceSku) {
    const skus = await listCueSkus(hydrated.sourceSku)
    const sku = skus.find((item) => item.code === hydrated.sourceSku)
    if (!sku) throw new Error('方案引用的 SKU 已不存在')
    const template = templateFromSpecification(sku.specification || {}, sku.name)
    hydrated.cueTemplateId = template.id
    hydrated.cueTemplate = template
    hydrated.skuSpecification = sku.specification
  }
  return hydrated
}
