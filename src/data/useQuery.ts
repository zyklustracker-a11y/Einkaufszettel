import { useCallback, useEffect, useRef, useState } from 'react'
import { germanDataError } from './client'

/**
 * Laden, Fehler, Ergebnis — an einer Stelle.
 *
 * Ohne so einen Haken bekäme jeder Screen dieselben drei `useState` und dieselbe
 * `try/catch`-Kette. Ein Screen ruft genau eine Ladefunktion auf (die alles
 * bündelt, was er braucht) und übergibt das Ergebnis an `<Async>` — damit bleibt
 * der Ladezustand an der Oberkante des Screens und zieht sich nicht durch die
 * Komponenten darunter.
 */

export interface QueryState<T> {
  data: T | null
  loading: boolean
  /**
   * Ist die Abfrage schon einmal durchgelaufen?
   *
   * Nicht dasselbe wie `data !== null`: Manche Abfragen antworten mit gutem
   * Grund `null` — „diesen Bon gibt es nicht" oder „es liegt kein erkannter Bon
   * vor". Ohne dieses Flag hinge so ein Screen für immer im Ladezustand, statt
   * seinen Leerzustand zu zeigen.
   */
  loaded: boolean
  /** Bereits auf Deutsch, direkt anzeigbar. */
  error: string | null
  reload: () => void
}

export function useQuery<T>(run: () => Promise<T>, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)

  /*
   * Die Ladefunktion wird bei jedem Rendern neu erzeugt. Stünde sie in der
   * Abhängigkeitsliste, liefe die Abfrage endlos. Deshalb steuert allein `deps`
   * (plus der Zähler für „noch einmal versuchen"), wann neu geladen wird.
   */
  const runRef = useRef(run)
  runRef.current = run

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    runRef.current().then(
      (result) => {
        if (cancelled) return
        setData(result)
        setLoaded(true)
        setLoading(false)
      },
      (cause: unknown) => {
        if (cancelled) return
        setError(germanDataError(cause))
        setLoading(false)
      },
    )

    // Verhindert, dass eine überholte Antwort ein neueres Ergebnis überschreibt.
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return { data, loading, loaded, error, reload }
}
