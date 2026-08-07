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
      { merchant: 'Rewe', date: '2026-08-14', price: 2.49 },
      { merchant: 'Edeka', date: '2026-08-02', price: 2.69 },
      { merchant: 'Lidl', date: '2026-07-12', price: 1.99 },
      { merchant: 'Rewe', date: '2026-06-19', price: 2.19 },
      { merchant: 'Aldi', date: '2026-06-04', price: 2.09 },
      { merchant: 'Rewe', date: '2026-05-21', price: 2.39 },
    ],
  },
  {
    id: 'h-milch',
    name: 'H-Milch 3,5 % (1 l)',
    categoryId: 'dairy',
    size: { amount: 1, unit: 'l' },
    purchases: [
      { merchant: 'Rewe', date: '2026-08-14', price: 1.29 },
      { merchant: 'Lidl', date: '2026-08-12', price: 1.15 },
      { merchant: 'Aldi', date: '2026-08-09', price: 1.09 },
      { merchant: 'Rewe', date: '2026-07-31', price: 1.29 },
      { merchant: 'Edeka', date: '2026-07-21', price: 1.35 },
      { merchant: 'Aldi', date: '2026-07-08', price: 1.09 },
    ],
  },
  {
    id: 'eier',
    name: 'Eier, Freiland (10er)',
    categoryId: 'staples',
    size: { amount: 10, unit: 'Stück' },
    purchases: [
      { merchant: 'Rewe', date: '2026-08-14', price: 3.49 },
      { merchant: 'Edeka', date: '2026-08-02', price: 3.19 },
      { merchant: 'Aldi', date: '2026-07-27', price: 3.29 },
      { merchant: 'Rewe', date: '2026-07-09', price: 3.49 },
      { merchant: 'Edeka', date: '2026-06-24', price: 3.29 },
    ],
  },
  {
    id: 'haehnchenbrust',
    name: 'Hähnchenbrust',
    categoryId: 'meat',
    size: null,
    purchases: [
      { merchant: 'Rewe', date: '2026-08-14', price: 6.99 },
      { merchant: 'Aldi', date: '2026-08-11', price: 5.49 },
      { merchant: 'Edeka', date: '2026-08-09', price: 7.29 },
      { merchant: 'Edeka', date: '2026-08-04', price: 7.19 },
      { merchant: 'Rewe', date: '2026-07-26', price: 7.49 },
      { merchant: 'Aldi', date: '2026-07-12', price: 5.99 },
    ],
  },
  {
    id: 'sauerteigbrot',
    name: 'Sauerteigbrot (750 g)',
    categoryId: 'bakery',
    size: { amount: 0.75, unit: 'kg' },
    purchases: [
      { merchant: 'Rewe', date: '2026-08-14', price: 2.49 },
      { merchant: 'Edeka', date: '2026-08-09', price: 3.19 },
      { merchant: 'Lidl', date: '2026-08-01', price: 2.79 },
      { merchant: 'Rewe', date: '2026-07-18', price: 2.49 },
      { merchant: 'Edeka', date: '2026-07-03', price: 3.19 },
    ],
  },
  {
    id: 'olivenoel',
    name: 'Olivenöl extra vergine (500 ml)',
    categoryId: 'staples',
    size: { amount: 0.5, unit: 'l' },
    purchases: [
      { merchant: 'Rewe', date: '2026-08-02', price: 8.49 },
      { merchant: 'Lidl', date: '2026-07-24', price: 6.99 },
      { merchant: 'Edeka', date: '2026-07-18', price: 9.29 },
      { merchant: 'Rewe', date: '2026-06-12', price: 8.99 },
    ],
  },
  {
    id: 'spuelmittel',
    name: 'Spülmittel (500 ml)',
    categoryId: 'nonfood',
    size: { amount: 0.5, unit: 'l' },
    purchases: [
      { merchant: 'Rewe', date: '2026-08-14', price: 1.79 },
      { merchant: 'Lidl', date: '2026-08-12', price: 1.29 },
      { merchant: 'Aldi', date: '2026-08-06', price: 1.19 },
      { merchant: 'Rewe', date: '2026-07-09', price: 1.79 },
    ],
  },
]
