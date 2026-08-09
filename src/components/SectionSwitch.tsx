import { NavLink } from 'react-router-dom'
import styles from './SectionSwitch.module.css'

/**
 * Der Umschalter oben in den Analysen: „Auswertung" und „Bestpreise".
 *
 * ---------------------------------------------------------------------------
 * WARUM ES IHN GIBT
 * ---------------------------------------------------------------------------
 *
 * Bis Schritt 15 hatten die Bestpreise einen eigenen Tab. Fünf Tabs plus
 * Scan-Knopf waren zu gedrängt, und schlimmer: Der Scan-Knopf saß damit nicht
 * mehr in der Mitte, obwohl das Design ihn genau dort vorsieht. Die Bestpreise
 * sind der Kandidat zum Zusammenlegen, weil sie inhaltlich dieselbe Frage
 * beantworten wie die Analysen — „was kostet was, und geht es günstiger".
 *
 * ---------------------------------------------------------------------------
 * ZWEI ROUTEN, KEIN ZUSTAND IM SCREEN
 * ---------------------------------------------------------------------------
 *
 * Der Umschalter sind zwei Verweise und keine Umschaltung innerhalb eines
 * Screens. Damit bleibt alles erhalten, was die Bestpreise schon hatten:
 * `/bestpreise` und `/bestpreise/:productId` funktionieren unverändert, die
 * Zurück-Geste des Browsers tut das Richtige, und ein Verweis auf ein einzelnes
 * Produkt bleibt gültig. Ein `useState` im Analysen-Screen hätte all das
 * gekostet — für nichts.
 *
 * Der zweite Verweis steht bewusst **ohne** `end`: Er soll auch dann als aktiv
 * gelten, wenn man gerade in einem Produkt-Detail steht.
 */
export function SectionSwitch() {
  const className = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.segment} ${styles['segment--active']}` : styles.segment

  return (
    <nav className={styles.track} aria-label="Bereich der Analysen">
      <NavLink to="/analysen" end className={className}>
        Auswertung
      </NavLink>
      <NavLink to="/bestpreise" className={className}>
        Bestpreise
      </NavLink>
    </nav>
  )
}
