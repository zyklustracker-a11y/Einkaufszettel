import type { Product } from '../types'

/**
 * Tracked products with their observed prices, newest first.
 *
 * Everything the Bestpreise screens show — best price, its age, the other
 * merchants' latest prices, the €/kg base price and the price history chart —
 * is derived from `purchases` in `src/lib/derive.ts`. Nothing is stored twice.
 *
 * "Hähnchenbrust" has no pack size on purpose: it is the edge case that shows
 * up as "ohne Mengenangabe" instead of a base price.
 */
export const products: Product[] = [
  {
    id: 'butter',
    name: 'Butter (250 g)',
    categoryId: 'dairy',
    size: { amount: 0.25, unit: 'kg' },
    purchases: [
      { merchantId: 'rewe', date: '2026-08-14', priceCents: 249 },
      { merchantId: 'edeka', date: '2026-08-02', priceCents: 269 },
      { merchantId: 'lidl', date: '2026-07-12', priceCents: 199 },
      { merchantId: 'rewe', date: '2026-06-19', priceCents: 219 },
      { merchantId: 'aldi', date: '2026-06-04', priceCents: 209 },
      { merchantId: 'rewe', date: '2026-05-21', priceCents: 239 },
    ],
  },
  {
    id: 'h-milch',
    name: 'H-Milch 3,5 % (1 l)',
    categoryId: 'dairy',
    size: { amount: 1, unit: 'l' },
    purchases: [
      { merchantId: 'rewe', date: '2026-08-14', priceCents: 129 },
      { merchantId: 'lidl', date: '2026-08-12', priceCents: 115 },
      { merchantId: 'aldi', date: '2026-08-09', priceCents: 109 },
      { merchantId: 'rewe', date: '2026-07-31', priceCents: 129 },
      { merchantId: 'edeka', date: '2026-07-21', priceCents: 135 },
      { merchantId: 'aldi', date: '2026-07-08', priceCents: 109 },
    ],
  },
  {
    id: 'eier',
    name: 'Eier, Freiland (10er)',
    categoryId: 'staples',
    size: { amount: 10, unit: 'Stück' },
    purchases: [
      { merchantId: 'rewe', date: '2026-08-14', priceCents: 349 },
      { merchantId: 'edeka', date: '2026-08-02', priceCents: 319 },
      { merchantId: 'aldi', date: '2026-07-27', priceCents: 329 },
      { merchantId: 'rewe', date: '2026-07-09', priceCents: 349 },
      { merchantId: 'edeka', date: '2026-06-24', priceCents: 329 },
    ],
  },
  {
    id: 'haehnchenbrust',
    name: 'Hähnchenbrust',
    categoryId: 'meat',
    size: null,
    purchases: [
      { merchantId: 'rewe', date: '2026-08-14', priceCents: 699 },
      { merchantId: 'aldi', date: '2026-08-11', priceCents: 549 },
      { merchantId: 'edeka', date: '2026-08-09', priceCents: 729 },
      { merchantId: 'edeka', date: '2026-08-04', priceCents: 719 },
      { merchantId: 'rewe', date: '2026-07-26', priceCents: 749 },
      { merchantId: 'aldi', date: '2026-07-12', priceCents: 599 },
    ],
  },
  {
    id: 'sauerteigbrot',
    name: 'Sauerteigbrot (750 g)',
    categoryId: 'bakery',
    size: { amount: 0.75, unit: 'kg' },
    purchases: [
      { merchantId: 'rewe', date: '2026-08-14', priceCents: 249 },
      { merchantId: 'edeka', date: '2026-08-09', priceCents: 319 },
      { merchantId: 'lidl', date: '2026-08-01', priceCents: 279 },
      { merchantId: 'rewe', date: '2026-07-18', priceCents: 249 },
      { merchantId: 'edeka', date: '2026-07-03', priceCents: 319 },
    ],
  },
  {
    id: 'olivenoel',
    name: 'Olivenöl extra vergine (500 ml)',
    categoryId: 'staples',
    size: { amount: 0.5, unit: 'l' },
    purchases: [
      { merchantId: 'rewe', date: '2026-08-02', priceCents: 849 },
      { merchantId: 'lidl', date: '2026-07-24', priceCents: 699 },
      { merchantId: 'edeka', date: '2026-07-18', priceCents: 929 },
      { merchantId: 'rewe', date: '2026-06-12', priceCents: 899 },
    ],
  },
  {
    id: 'spuelmittel',
    name: 'Spülmittel (500 ml)',
    categoryId: 'nonfood',
    size: { amount: 0.5, unit: 'l' },
    purchases: [
      { merchantId: 'rewe', date: '2026-08-14', priceCents: 179 },
      { merchantId: 'lidl', date: '2026-08-12', priceCents: 129 },
      { merchantId: 'aldi', date: '2026-08-06', priceCents: 119 },
      { merchantId: 'rewe', date: '2026-07-09', priceCents: 179 },
    ],
  },
]
