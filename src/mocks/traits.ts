import type { Trait } from '../types'

/**
 * The household's traits.
 *
 * Data, not code: there is deliberately no union type and no enum for these
 * (PROJEKT.md). The user adds, renames, reweights and deactivates them, and
 * `description` doubles as the instruction the model gets for that trait — so a
 * new trait works from the next scan on without a code change.
 *
 * The first eight are the shipped defaults. The five after them back the dairy
 * attributes `milkHeat` / `milkHomogenized`, which is why `roh`…`uht` share the
 * `milch_basis` group with `milch` itself: an H-Milch must score as `uht` and
 * not additionally as `milch`. `homogenisiert` sits outside that group on
 * purpose — homogenising happens independently of how the milk was heated.
 */
export const traits: Trait[] = [
  {
    id: 'verarbeitet',
    label: 'Hochverarbeitet',
    short: 'V',
    description:
      'Industriell stark verarbeitete Produkte mit langer Zutatenliste – Fertiggerichte, Tiefkühlware, Snacks.',
    weight: -3,
    tip: 'Statt Fertiggericht: einmal selbst kochen und portionsweise einfrieren.',
    active: true,
    isDefault: true,
  },
  {
    id: 'industriezucker',
    label: 'Industriezucker',
    short: 'Z',
    description:
      'Zugesetzter Zucker in jeder Form – Saccharose, Glukose- und Fruktosesirup, Maltodextrin.',
    weight: -3,
    tip: 'Statt gesüßtem Joghurt: Naturjoghurt mit frischem Obst.',
    active: true,
    isDefault: true,
  },
  {
    id: 'samenoel',
    label: 'Samenöl',
    short: 'Ö',
    description: 'Raffinierte Öle aus Samen und Kernen – Sonnenblumen-, Raps-, Soja-, Maiskeimöl.',
    weight: -3,
    group: 'fette',
    tip: 'Statt Sonnenblumenöl: Butter, Ghee oder Olivenöl.',
    active: true,
    isDefault: true,
  },
  {
    id: 'pflanzenfett',
    label: 'Pflanzliches Fett',
    short: 'P',
    description: 'Sonstige raffinierte oder gehärtete Pflanzenfette, etwa Palmfett in Backwaren.',
    weight: -2,
    group: 'fette',
    tip: 'Statt Gebäck mit Palmfett: Varianten mit Butter.',
    active: true,
    isDefault: true,
  },
  {
    id: 'gluten',
    label: 'Gluten',
    short: 'G',
    description: 'Glutenhaltige Getreide – Weizen, Dinkel, Roggen, Gerste.',
    weight: -2,
    group: 'getreide',
    tip: 'Statt Weizentoast: Sauerteigbrot mit langer Führung oder Buchweizenbrot.',
    active: true,
    isDefault: true,
  },
  {
    id: 'weizen',
    label: 'Weizen',
    short: 'W',
    description: 'Speziell Weizen, auch als Weizenmehl, Hartweizengrieß oder Weizenstärke.',
    weight: -3,
    group: 'getreide',
    tip: 'Statt Weizennudeln: Nudeln aus Buchweizen, Linsen oder Kichererbsen.',
    active: true,
    isDefault: true,
  },
  {
    id: 'milch',
    label: 'Milch',
    short: 'M',
    description: 'Enthält Kuhmilch oder Milchbestandteile.',
    weight: 0,
    group: 'milch_basis',
    tip: 'Neutral – wird nur beobachtet, kein Handlungsbedarf.',
    active: true,
    isDefault: true,
  },
  {
    id: 'zusatzstoffe',
    label: 'Zusatzstoffe',
    short: 'E',
    description:
      'Deklarationspflichtige Zusatzstoffe – Farb- und Konservierungsstoffe, Geschmacksverstärker, Emulgatoren.',
    weight: -2,
    tip: 'Statt Produkten mit E-Nummern: Varianten mit kurzer Zutatenliste.',
    // Off by default; items already carry the trait, so switching it on shows
    // its spending straight away without a rescan.
    active: false,
    isDefault: true,
  },

  /* ------------------------------------------------ from the milk attributes */

  {
    id: 'roh',
    label: 'Rohmilch',
    short: 'R',
    description: 'Nicht erhitzte Milch, direkt ab Hof.',
    weight: 2,
    group: 'milch_basis',
    tip: 'Rohmilch kühl halten und zügig verbrauchen.',
    active: true,
    isDefault: true,
  },
  {
    id: 'pasteurisiert',
    label: 'Pasteurisiert',
    short: 'Pa',
    description: 'Kurz erhitzte Milch, der übliche Frischmilch-Standard.',
    weight: 0,
    group: 'milch_basis',
    tip: 'Neutral – der übliche Standard bei Frischmilch.',
    active: true,
    isDefault: true,
  },
  {
    id: 'esl',
    label: 'ESL-Milch',
    short: 'ES',
    description: 'Länger haltbare Frischmilch, stärker erhitzt als pasteurisierte Milch.',
    weight: -1,
    group: 'milch_basis',
    tip: 'Statt ESL: klassische Frischmilch aus dem Kühlregal.',
    active: true,
    isDefault: true,
  },
  {
    id: 'uht',
    label: 'H-Milch',
    short: 'H',
    description: 'Ultrahocherhitzte Milch, ungekühlt lange haltbar.',
    weight: -2,
    group: 'milch_basis',
    tip: 'Statt H-Milch: Frischmilch aus dem Kühlregal.',
    active: true,
    isDefault: true,
  },
  {
    id: 'homogenisiert',
    label: 'Homogenisiert',
    short: 'Ho',
    // No group on purpose: an extra processing step, independent of the heating.
    description: 'Fettkügelchen mechanisch zerkleinert, damit sich der Rahm nicht absetzt.',
    weight: -1,
    tip: 'Statt homogenisierter Milch: nicht homogenisierte Milch mit Rahmschicht.',
    active: true,
    isDefault: true,
  },
]
