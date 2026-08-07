import { NavLink, useNavigate } from 'react-router-dom'
import { BarsIcon, GridIcon, HealthIcon, ScanIcon, TagIcon } from './icons'
import styles from './TabBar.module.css'

const TABS = [
  { to: '/', label: 'Übersicht', Icon: GridIcon, end: true },
  { to: '/bestpreise', label: 'Bestpreise', Icon: TagIcon, end: false },
  { to: '/analysen', label: 'Analysen', Icon: BarsIcon, end: false },
  { to: '/gesundheit', label: 'Gesundheit', Icon: HealthIcon, end: false },
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
  const [overview, prices, analytics, health] = TABS

  return (
    <nav className={styles.bar}>
      <Tab {...overview} />
      <Tab {...prices} />
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
