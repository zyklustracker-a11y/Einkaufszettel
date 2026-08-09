import { NavLink, useNavigate } from 'react-router-dom'
import { BarsIcon, GridIcon, HealthIcon, ListIcon, ScanIcon, TagIcon } from './icons'
import styles from './TabBar.module.css'

/**
 * Fünf Tabs plus Scan-Knopf.
 *
 * Der Zettel kam mit Schritt 9 dazu (KONZEPT-ERWEITERUNGEN.md, Abschnitt 6).
 * Sechs Felder auf 390 px sind rund 64 px je Feld — das trägt die Beschriftung
 * bei 10,5 px, wenn sie kurz ist. Deshalb heißen zwei Tabs jetzt anders:
 * „Bestpreise" wurde zu „Preise", „Gesundheit" zu „Gesund". Die Screens selbst
 * behalten ihre vollen Titel; gekürzt ist nur das, was in die Leiste muss.
 */
const TABS = [
  { to: '/', label: 'Übersicht', Icon: GridIcon, end: true },
  { to: '/bestpreise', label: 'Preise', Icon: TagIcon, end: false },
  { to: '/zettel', label: 'Zettel', Icon: ListIcon, end: false },
  { to: '/analysen', label: 'Analysen', Icon: BarsIcon, end: false },
  { to: '/gesundheit', label: 'Gesund', Icon: HealthIcon, end: false },
]

function Tab({ to, label, Icon, end }: (typeof TABS)[number]) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? `${styles.tab} ${styles.active}` : styles.tab)}>
      <Icon />
      <span className={styles.label}>{label}</span>
    </NavLink>
  )
}

export function TabBar() {
  const navigate = useNavigate()
  const [overview, prices, list, analytics, health] = TABS

  return (
    <nav className={styles.bar}>
      <Tab {...overview} />
      <Tab {...prices} />
      <Tab {...list} />
      {/*
        Der Scan-Knopf sitzt weiterhin in der Mitte — bei fünf Tabs also nach
        dem dritten. Er ist der einzige Weg in den Scan-Ablauf und soll dort
        bleiben, wo der Daumen ihn erwartet.
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
