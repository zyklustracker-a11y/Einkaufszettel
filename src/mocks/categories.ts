import type { Category } from '../types'

/**
 * Die neun mitgelieferten Kategorien, so wie `seed_household()` sie anlegt.
 *
 * Seit Schritt 5 sind Kategorien verwaltbare Daten: Erklärung, Farbe und
 * Aktiv-Kennzeichen gehören dazu (KONZEPT-ERWEITERUNGEN.md, Abschnitt 2). Die
 * Werte hier stehen deshalb genauso in
 * `supabase/migrations/0004_erweiterungen.sql` — wer dort etwas ändert, ändert
 * es hier mit.
 */
export const categories: Category[] = [
  {
    id: 'produce',
    name: 'Obst & Gemüse',
    isFood: true,
    description:
      'Frisches Obst, Gemüse, Salat, Kräuter und Pilze – auch tiefgekühlt, solange nichts zugesetzt ist.',
    active: true,
    color: '#16915c',
    sortOrder: 1,
    isDefault: true,
  },
  {
    id: 'meat',
    name: 'Fleisch & Fisch',
    isFood: true,
    description: 'Fleisch, Geflügel, Fisch, Meeresfrüchte sowie Wurst und Schinken.',
    active: true,
    color: '#1fa86c',
    sortOrder: 2,
    isDefault: true,
  },
  {
    id: 'dairy',
    name: 'Milchprodukte',
    isFood: true,
    description: 'Milch, Joghurt, Quark, Sahne, Butter, Käse und Milchersatz aus dem Kühlregal.',
    active: true,
    color: '#43bc85',
    sortOrder: 3,
    isDefault: true,
  },
  {
    id: 'bakery',
    name: 'Backwaren',
    isFood: true,
    description: 'Brot, Brötchen, Kuchen, Gebäck und Teigwaren aus der Backabteilung.',
    active: true,
    color: '#6acb9e',
    sortOrder: 4,
    isDefault: true,
  },
  {
    id: 'drinks',
    name: 'Getränke',
    isFood: true,
    description: 'Wasser, Saft, Limonade, Kaffee, Tee, Bier, Wein und Spirituosen.',
    active: true,
    color: '#8fd8b6',
    sortOrder: 5,
    isDefault: true,
  },
  {
    id: 'sweets',
    name: 'Süßes & Snacks',
    isFood: true,
    description: 'Schokolade, Bonbons, Kekse, Chips, Nüsse und salziges Knabberzeug.',
    active: true,
    color: '#afe3cb',
    sortOrder: 6,
    isDefault: true,
  },
  {
    id: 'readymeals',
    name: 'Fertiggerichte',
    isFood: true,
    description:
      'Zubereitete Speisen zum Aufwärmen – Pizza, Tiefkühlgerichte, Konserven, Suppen, Dosenravioli.',
    active: true,
    color: '#c6ecdb',
    sortOrder: 7,
    isDefault: true,
  },
  {
    id: 'staples',
    name: 'Grundnahrungsmittel',
    isFood: true,
    description:
      'Vorrat zum Selberkochen: Mehl, Reis, Nudeln, Öl, Zucker, Salz, Gewürze, Hülsenfrüchte, Eier.',
    active: true,
    color: '#dcf2e8',
    sortOrder: 8,
    isDefault: true,
  },
  {
    id: 'nonfood',
    name: 'Non-Food',
    isFood: false,
    description:
      'Alles, was man nicht isst: Reinigungsmittel, Hygieneartikel, Papierwaren, Haushaltswaren, Tierfutter.',
    active: true,
    color: '#7c8a99',
    sortOrder: 9,
    isDefault: true,
  },
]
