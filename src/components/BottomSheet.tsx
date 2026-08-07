import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import styles from './BottomSheet.module.css'

/**
 * Modal sheet anchored to the bottom of the app shell. Closes on Escape, on a
 * tap outside, and moves focus into itself so keyboard and VoiceOver users are
 * not left behind on the list underneath.
 */
export function BottomSheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const sheet = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    sheet.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <>
      <button type="button" className={styles.overlay} aria-label="Schließen" onClick={onClose} />
      <div
        ref={sheet}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className={styles.grabber} />
        <h2 className={styles.title}>{title}</h2>
        {children}
      </div>
    </>
  )
}
