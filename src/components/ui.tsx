import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { getHealthFlag } from '../data'
import { initials } from '../lib/format'
import type { HealthFlagId } from '../types'
import { ChevronLeftIcon, SearchIcon } from './icons'
import styles from './ui.module.css'

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className={styles.backLink}>
      <ChevronLeftIcon />
      {children}
    </Link>
  )
}

/** Single-letter health warning, e.g. `G` for gluten. */
export function FlagBadge({ flag }: { flag: HealthFlagId }) {
  const { letter, label } = getHealthFlag(flag)
  return (
    <span className={styles.flag} title={label} aria-label={label}>
      {letter}
    </span>
  )
}

export function CategoryChip({ children }: { children: ReactNode }) {
  return <span className={styles.chip}>{children}</span>
}

export function Avatar({ name, round = false }: { name: string; round?: boolean }) {
  return (
    <span className={round ? `${styles.avatar} ${styles['avatar--round']}` : styles.avatar} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: () => void
  label: string
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={styles.toggle} onClick={onChange}>
      <span className={styles.knob} />
    </button>
  )
}

/**
 * Budget bar. `fraction` fills the track; `markerFraction` draws the budget line
 * so an over-budget forecast still fits on the same scale.
 */
export function ProgressBar({
  fraction,
  markerFraction,
  over = false,
  label,
}: {
  fraction: number
  markerFraction?: number
  over?: boolean
  label: string
}) {
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={over ? `${styles.fill} ${styles['fill--over']}` : styles.fill}
        style={{ width: `${(fraction * 100).toFixed(1)}%` }}
      />
      {markerFraction !== undefined && (
        <div className={styles.marker} style={{ left: `${(markerFraction * 100).toFixed(1)}%` }} />
      )}
    </div>
  )
}

export function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className={styles.search}>
      <span style={{ opacity: 0.5, display: 'flex' }}>
        <SearchIcon />
      </span>
      <input
        type="search"
        className={styles.searchInput}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}
