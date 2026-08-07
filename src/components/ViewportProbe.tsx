import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './ViewportProbe.module.css'

/**
 * TEMPORARY diagnostic panel — remove once the strip below the tab bar is
 * understood.
 *
 * Twice now the cause has been guessed at from a screenshot, and twice the fix
 * missed. This reads the real numbers off the device instead. The interesting
 * ones are the last two lines: if `.app` does not reach `innerHeight`, the shell
 * is short and the strip is whatever shows behind it.
 *
 * `env(safe-area-inset-*)` cannot be read from JavaScript, so two hidden probe
 * elements get their height from it and are measured instead.
 */

interface Box {
  top: number
  bottom: number
  height: number
}

interface Snapshot {
  n: number
  innerHeight: number
  visualViewport: number | null
  clientHeight: number
  screenHeight: number
  dpr: number
  safeTop: number
  safeBottom: number
  root: Box | null
  app: Box | null
  bar: Box | null
  standaloneMedia: boolean
  standaloneNav: boolean | null
}

function boxOf(element: Element | null): Box | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return { top: rect.top, bottom: rect.bottom, height: rect.height }
}

/** One decimal: rects can be fractional, and that fraction may be the bug. */
const num = (value: number) => value.toFixed(1).replace(/\.0$/, '')

function line(label: string, value: string): string {
  return `${label.padEnd(18, ' ')}${value}`
}

function boxLine(label: string, box: Box | null): string {
  if (!box) return line(label, '— nicht gefunden')
  return line(label, `t ${num(box.top)}  b ${num(box.bottom)}  h ${num(box.height)}`)
}

export function ViewportProbe() {
  const safeTopRef = useRef<HTMLDivElement>(null)
  const safeBottomRef = useRef<HTMLDivElement>(null)
  const counter = useRef(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)

  const measure = useCallback(() => {
    counter.current += 1
    const nav = navigator as Navigator & { standalone?: boolean }
    setSnapshot({
      n: counter.current,
      innerHeight: window.innerHeight,
      visualViewport: window.visualViewport?.height ?? null,
      clientHeight: document.documentElement.clientHeight,
      screenHeight: window.screen.height,
      dpr: window.devicePixelRatio,
      safeTop: safeTopRef.current?.getBoundingClientRect().height ?? -1,
      safeBottom: safeBottomRef.current?.getBoundingClientRect().height ?? -1,
      root: boxOf(document.getElementById('root')),
      app: boxOf(document.querySelector('.app')),
      bar: boxOf(document.querySelector('nav')),
      standaloneMedia: window.matchMedia('(display-mode: standalone)').matches,
      standaloneNav: nav.standalone ?? null,
    })
  }, [])

  useEffect(() => {
    // After the first paint, not during layout: the value we are hunting is one
    // that WebKit reportedly gets wrong on the first frame.
    const frame = requestAnimationFrame(measure)

    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    window.visualViewport?.addEventListener('resize', measure)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [measure])

  const rows = snapshot
    ? [
        line('innerHeight', num(snapshot.innerHeight)),
        line('visualViewport', snapshot.visualViewport === null ? '— nicht verfügbar' : num(snapshot.visualViewport)),
        line('docEl.client', num(snapshot.clientHeight)),
        line('screen.height', `${num(snapshot.screenHeight)}   dpr ${snapshot.dpr}`),
        line('safe-area top', num(snapshot.safeTop)),
        line('safe-area bottom', num(snapshot.safeBottom)),
        boxLine('#root', snapshot.root),
        boxLine('.app', snapshot.app),
        boxLine('nav (Tab-Bar)', snapshot.bar),
        line('standalone', `mm ${snapshot.standaloneMedia}  nav ${snapshot.standaloneNav}`),
        line('app.bottom−inner', snapshot.app ? num(snapshot.app.bottom - snapshot.innerHeight) : '—'),
        line('root.bottom−inner', snapshot.root ? num(snapshot.root.bottom - snapshot.innerHeight) : '—'),
      ]
    : ['messe…']

  return (
    <button type="button" className={styles.panel} onClick={measure}>
      {/* Hidden, so they take their height from env() without showing up. */}
      <div ref={safeTopRef} className={styles.probeTop} />
      <div ref={safeBottomRef} className={styles.probeBottom} />

      <div className={styles.head}>MESSUNG #{snapshot?.n ?? 0} · antippen zum Neumessen</div>
      {rows.map((row) => (
        <div key={row} className={styles.row}>
          {row}
        </div>
      ))}
    </button>
  )
}
