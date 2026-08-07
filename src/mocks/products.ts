import type { Product } from '../types'
import { daysAgo } from './dates'

/**
 * Tracked products with their observed prices, newest first, dated relative to
 * today so the histories keep moving with the calendar.
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
      { merchantId: 'rewe', date: daysAgo(0), priceCents: 249 },
      { merchantId: 'edeka', date: daysAgo(12), priceCents: 269 },
      { merchantId: 'lidl', date: daysAgo(33), priceCents: 199 },
      { merchantId: 'rewe', date: daysAgo(56), priceCents: 219 },
      { merchantId: 'aldi', date: daysAgo(71), priceCents: 209 },
      { merchantId: 'rewe', date: daysAgo(85), priceCents: 239 },
    ],
  },
  {
    id: 'h-milch',
    name: 'H-Milch 3,5 % (1 l)',
    categoryId: 'dairy',
    size: { amount: 1, unit: 'l' },
    purchases: [
      { merchantId: 'rewe', date: daysAgo(0), priceCents: 129 },
      { merchantId: 'lidl', date: daysAgo(2), priceCents: 115 },
      { merchantId: 'aldi', date: daysAgo(5), priceCents: 109 },
      { merchantId: 'rewe', date: daysAgo(14), priceCents: 129 },
      { merchantId: 'edeka', date: daysAgo(24), priceCents: 135 },
      { merchantId: 'aldi', date: daysAgo(37), priceCents: 109 },
    ],
  },
  {
    id: 'eier',
    name: 'Eier, Freiland (10er)',
    categoryId: 'staples',
    size: { amount: 10, unit: 'Stück' },
    purchases: [
      { merchantId: 'rewe', date: daysAgo(0), priceCents: 349 },
      { merchantId: 'edeka', date: daysAgo(12), priceCents: 319 },
      { merchantId: 'aldi', date: daysAgo(18), priceCents: 329 },
      { merchantId: 'rewe', date: daysAgo(36), priceCents: 349 },
      { merchantId: 'edeka', date: daysAgo(51), priceCents: 329 },
    ],
  },
  {
    id: 'haehnchenbrust',
    name: 'Hähnchenbrust',
    categoryId: 'meat',
    size: null,
    purchases: [
      { merchantId: 'rewe', date: daysAgo(0), priceCents: 699 },
      { merchantId: 'aldi', date: daysAgo(3), priceCents: 549 },
      { merchantId: 'edeka', date: daysAgo(5), priceCents: 729 },
      { merchantId: 'edeka', date: daysAgo(10), priceCents: 719 },
      { merchantId: 'rewe', date: daysAgo(19), priceCents: 749 },
      { merchantId: 'aldi', date: daysAgo(33), priceCents: 599 },
    ],
  },
  {
    id: 'sauerteigbrot',
    name: 'Sauerteigbrot (750 g)',
    categoryId: 'bakery',
    size: { amount: 0.75, unit: 'kg' },
    purchases: [
      { merchantId: 'rewe', date: daysAgo(0), priceCents: 249 },
      { merchantId: 'edeka', date: daysAgo(5), priceCents: 319 },
      { merchantId: 'lidl', date: daysAgo(13), priceCents: 279 },
      { merchantId: 'rewe', date: daysAgo(27), priceCents: 249 },
      { merchantId: 'edeka', date: daysAgo(42), priceCents: 319 },
    ],
  },
  {
    id: 'olivenoel',
    name: 'Olivenöl extra vergine (500 ml)',
    categoryId: 'staples',
    size: { amount: 0.5, unit: 'l' },
    purchases: [
      { merchantId: 'rewe', date: daysAgo(12), priceCents: 849 },
      { merchantId: 'lidl', date: daysAgo(21), priceCents: 699 },
      { merchantId: 'edeka', date: daysAgo(27), priceCents: 929 },
      { merchantId: 'rewe', date: daysAgo(63), priceCents: 899 },
    ],
  },
  {
    id: 'spuelmittel',
    name: 'Spülmittel (500 ml)',
    categoryId: 'nonfood',
    size: { amount: 0.5, unit: 'l' },
    purchases: [
      { merchantId: 'rewe', date: daysAgo(0), priceCents: 179 },
      { merchantId: 'lidl', date: daysAgo(2), priceCents: 129 },
      { merchantId: 'aldi', date: daysAgo(8), priceCents: 119 },
      { merchantId: 'rewe', date: daysAgo(36), priceCents: 179 },
    ],
  },
]
