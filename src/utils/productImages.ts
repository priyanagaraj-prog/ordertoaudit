/**
 * Product catalog photography map using generated local studio assets.
 */
export const PRODUCT_STUDIO_IMAGES = {
  murukku: '/src/assets/images/product_murukku_pack_1795426011170.jpg',
  idliBatter: '/src/assets/images/product_idli_batter_1795426011447.jpg',
  sambarMasala: '/src/assets/images/product_sambar_masala_1795426011490.jpg',
  milletPongal: '/src/assets/images/product_millet_pongal_1795426010942.jpg',
  filterCoffee: '/src/assets/images/product_filter_coffee_1795426010364.jpg',
  bananaChips: '/src/assets/images/product_banana_chips_1795426010726.jpg',
} as const;

export function resolveProductImage(skuOrId: string, explicitUrl?: string): string {
  if (explicitUrl) return explicitUrl;
  const key = skuOrId.toLowerCase();
  if (key.includes('mrk') || key.includes('murukku')) return PRODUCT_STUDIO_IMAGES.murukku;
  if (key.includes('bat') || key.includes('idli')) return PRODUCT_STUDIO_IMAGES.idliBatter;
  if (key.includes('mas') || key.includes('sambar')) return PRODUCT_STUDIO_IMAGES.sambarMasala;
  if (key.includes('mix') || key.includes('pongal') || key.includes('millet')) {
    return PRODUCT_STUDIO_IMAGES.milletPongal;
  }
  if (key.includes('cof') || key.includes('coffee')) return PRODUCT_STUDIO_IMAGES.filterCoffee;
  if (key.includes('snk') || key.includes('chip') || key.includes('banana')) {
    return PRODUCT_STUDIO_IMAGES.bananaChips;
  }
  return PRODUCT_STUDIO_IMAGES.murukku;
}
