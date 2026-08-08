import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { QueryState } from '../data/useQuery'
import { ScanIcon } from './icons'
import styles from './states.module.css'

/**
 * Die drei Zustände, die jeder Screen nach dem Umbau auf echte Abfragen haben
 * kann: es lädt, es ist schiefgegangen, oder es ist noch nichts da.
 *
 * Alle drei sehen aus wie der Rest der App — dieselben Karten, dieselben
 * Abstände, dieselben Farbtoken. Im Design sind sie nicht vorgesehen, deshalb
 * halten sie sich streng an das, was schon existiert, und erfinden nichts dazu.
 */

/* ------------------------------------------------------------------- laden */

/** Platzhalter in Kartenform. Kein Spinner: das Gerüst bleibt so ruhig stehen. */
export function LoadingCards({ count = 3, chart = true }: { count?: number; chart?: boolean }) {
  return (
    <div role="status" aria-live="polite">
      <span className="visuallyHidden">Daten werden geladen…</span>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={styles.skeletonCard} aria-hidden="true">
          <div className={`${styles.line} ${styles['line--title']}`} />
          <div className={`${styles.line} ${styles['line--wide']}`} />
          <div className={`${styles.line} ${styles['line--half']}`} />
          {chart && index === 0 && <div className={`${styles.line} ${styles['line--block']}`} />}
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ Fehler */

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className={styles.errorCard} role="alert">
      <div className={styles.errorTitle}>Das hat nicht geklappt</div>
      <p className={styles.errorText}>{message}</p>
      {onRetry && (
        <button type="button" className={styles.retry} onClick={onRetry}>
          Noch einmal versuchen
        </button>
      )}
    </section>
  )
}

/* -------------------------------------------------------------------- leer */

/**
 * „Hier steht später etwas."
 *
 * `scanHint` blendet den Weg zum Scan-Knopf ein — überall dort, wo genau das
 * der nächste sinnvolle Schritt ist.
 */
export function EmptyState({
  title,
  children,
  scanHint = false,
  link,
  inline = false,
}: {
  title: string
  children: ReactNode
  scanHint?: boolean
  link?: { to: string; label: string }
  inline?: boolean
}) {
  return (
    <section className={inline ? styles.inline : styles.empty}>
      {!inline && (
        <div className={styles.mark} aria-hidden="true">
          <ScanIcon />
        </div>
      )}
      <div className={styles.emptyTitle}>{title}</div>
      <p className={styles.emptyText}>{children}</p>
      {scanHint && (
        <Link to="/scan" className={styles.scanLink}>
          <ScanIcon />
          Ersten Bon scannen
        </Link>
      )}
      {link && (
        <Link to={link.to} className={styles.textLink}>
          {link.label}
        </Link>
      )}
    </section>
  )
}

/* ----------------------------------------------------------------- Klammer */

/**
 * Bindet einen Abfragezustand an die Anzeige: lädt → Platzhalter, Fehler →
 * Karte mit „Noch einmal versuchen", sonst die Daten.
 *
 * Dadurch steht in jedem Screen genau eine Stelle, die sich mit Laden und
 * Fehlern beschäftigt — der Rest bekommt fertige Daten und muss nichts davon
 * wissen.
 */
export function Async<T>({
  state,
  children,
  loading,
}: {
  state: QueryState<T>
  children: (data: T) => ReactNode
  loading?: ReactNode
}) {
  if (state.error) return <ErrorCard message={state.error} onRetry={state.reload} />
  if (!state.loaded) return <>{loading ?? <LoadingCards />}</>
  /*
   * `loaded` heißt: Das Versprechen ist eingelöst, `data` trägt genau das, was
   * die Abfrage geliefert hat — auch wenn das `null` ist. Deshalb ist die
   * Umtypisierung hier sicher, und nur deshalb können Screens, deren Abfrage
   * bewusst `null` liefern kann, ihren Leerzustand überhaupt erreichen.
   */
  return <>{children(state.data as T)}</>
}
