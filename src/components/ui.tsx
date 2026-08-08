import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { initials } from '../lib/format'
import type { Trait } from '../types'
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

/**
 * The trait's 1–2 character badge, e.g. `G` for gluten. The tone follows the
 * weight: negative warns, 0 is merely observed, positive is a credit — a
 * Rohmilch (+2) must not look like a warning.
 */
export function TraitBadge({ trait }: { trait: Trait }) {
  return (
    <span
      className={`${styles.trait} ${styles[`trait--${toneOf(trait)}`]}`}
      title={trait.label}
      aria-label={trait.label}
    >
      {trait.short}
    </span>
  )
}

export type TraitTone = 'critical' | 'neutral' | 'positive'

export function toneOf(trait: Trait): TraitTone {
  if (trait.weight < 0) return 'critical'
  if (trait.weight > 0) return 'positive'
  return 'neutral'
}

/** `+2` — stands in for the traits that did not fit on the row. */
export function TraitOverflow({ hidden }: { hidden: Trait[] }) {
  const names = hidden.map((trait) => trait.label).join(', ')
  return (
    <span className={`${styles.trait} ${styles['trait--neutral']}`} title={names} aria-label={names}>
      +{hidden.length}
    </span>
  )
}

export function CategoryChip({ children }: { children: ReactNode }) {
  return <span className={styles.chip}>{children}</span>
}

/**
 * Kürzel oder Profilbild. Lädt das Bild nicht, fällt die Anzeige auf das Kürzel
 * zurück — ein Google-Profilbild ist nicht garantiert erreichbar.
 */
export function Avatar({
  name,
  src,
  round = false,
}: {
  name: string
  src?: string | null
  round?: boolean
}) {
  const [imageFailed, setImageFailed] = useState(false)
  const className = round ? `${styles.avatar} ${styles['avatar--round']}` : styles.avatar

  if (src && !imageFailed) {
    return (
      <img
        className={`${className} ${styles['avatar--image']}`}
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setImageFailed(true)}
      />
    )
  }

  return (
    <span className={className} aria-hidden="true">
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
