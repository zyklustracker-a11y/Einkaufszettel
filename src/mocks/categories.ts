import type { Category, HealthFlag, HealthFlagId } from '../types'

export const categories: Category[] = [
  { id: 'produce', name: 'Obst & Gemüse', isFood: true },
  { id: 'meat', name: 'Fleisch & Fisch', isFood: true },
  { id: 'dairy', name: 'Milchprodukte', isFood: true },
  { id: 'bakery', name: 'Backwaren', isFood: true },
  { id: 'drinks', name: 'Getränke', isFood: true },
  { id: 'sweets', name: 'Süßes & Snacks', isFood: true },
  { id: 'readymeals', name: 'Fertiggerichte', isFood: true },
  { id: 'staples', name: 'Grundnahrungsmittel', isFood: true },
  { id: 'nonfood', name: 'Non-Food', isFood: false },
]

export const healthFlags: Record<HealthFlagId, HealthFlag> = {
  processed: { id: 'processed', letter: 'V', label: 'verarbeitet' },
  seedOil: { id: 'seedOil', letter: 'Ö', label: 'Samenöl' },
  gluten: { id: 'gluten', letter: 'G', label: 'Gluten' },
  cheapDairy: { id: 'cheapDairy', letter: 'M', label: 'Billigmilch' },
}

/** Legend order for the flag key under the correction list. */
export const healthFlagOrder: HealthFlagId[] = ['processed', 'seedOil', 'gluten', 'cheapDairy']
