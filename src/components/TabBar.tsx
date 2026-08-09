import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { BarsIcon, GridIcon, HealthIcon, ListIcon, ScanIcon } from './icons'
import styles from './TabBar.module.css'

/**
 * Vier Tabs, der Scan-Knopf in der Mitte.
 *
 * ---------------------------------------------------------------------------
 * WARUM ES WIEDER VIER SIND
 * ---------------------------------------------------------------------------
 *
 * Mit Schritt 9 kam der Einkaufszettel als fünfter Tab dazu. Am Gerät hat sich
 * gezeigt, was das Konzept selbst als Möglichkeit offengelassen hatte: Sechs
 * Felder sind zu gedrängt — und schwerer wiegt, dass der Scan-Knopf damit
 * **nicht mehr mittig** saß. Er ist der einzige Weg in den Scan-Ablauf und der
 * am häufigsten getroffene Punkt der ganzen App; das Design setzt ihn nicht
 * ohne Grund in die Mitte.
 *
 * Weichen mussten die **Bestpreise**, nicht der Zettel: Der Zettel wird im Laden
 * benutzt und muss einen Daumen entfernt sein. Die Bestpreise beantworten
 * dieselbe Frage wie die Analysen — „was kostet was, und geht es günstiger" —
 * und sitzen dort jetzt hinter einem Umschalter (`SectionSwitch`). Der Screen
 * und seine Routen sind unverändert; es ändert sich nur der Weg dorthin.
 *
 * Damit passen auch die ausgeschriebenen Beschriftungen wieder: Bei fünf
 * Feldern bleiben rund 78 px je Tab statt 64.
 *
 * `alsoActive` ist der Preis dafür: Der Analysen-Tab muss auch dann leuchten,
 * wenn man gerade in den Bestpreisen steht. Ein `NavLink` allein kann das nicht
 * — er kennt nur seine eigene Adresse.
 */
const TABS = [
  { to: '/', label: 'Übersicht', Icon: GridIcon, end: true, alsoActive: [] as string[] },
  { to: '/zettel', label: 'Zettel', Icon: ListIcon, end: false, alsoActive: [] },
  { to: '/analysen', label: 'Analysen', Icon: BarsIcon, end: false, alsoActive: ['/bestpreise'] },
  { to: '/gesundheit', label: 'Gesundheit', Icon: HealthIcon, end: false, alsoActive: [] },
]

function Tab({ to, label, Icon, end, alsoActive }: (typeof TABS)[number]) {
  const { pathname } = useLocation()
  const elsewhere = alsoActive.some((base) => pathname.startsWith(base))

  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        isActive || elsewhere ? `${styles.tab} ${styles.active}` : styles.tab
      }
    >
      <Icon />
      <span className={styles.label}>{label}</span>
    </NavLink>
  )
}

export function TabBar() {
  const navigate = useNavigate()
  const [overview, list, analytics, health] = TABS

  return (
    <nav className={styles.bar}>
      <Tab {...overview} />
      <Tab {...list} />
      {/*
        Zwei Tabs links, zwei rechts — dadurch sitzt der Knopf ohne Rechnerei
        genau in der Mitte. Genau das ging mit fünf Tabs verloren.
      */}
      <div className={styles.scanSlot}>
        <button type="button" className={styles.scanButton} onClick={() => navigate('/scan')} aria-label="Bon scannen">
          <ScanIcon />
        </button>
      </div>
      <Tab {...analytics} />
      <Tab {...health} />
    </nav>
  )
}
