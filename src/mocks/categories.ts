import type { Category } from '../types'

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
