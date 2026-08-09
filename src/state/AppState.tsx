import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export type Theme = 'light' | 'dark'

/**
 * Was rein am Gerät hängt.
 *
 * Seit Schritt 2c steht hier bewusst **kein** Monatsbudget mehr: das gehört dem
 * Haushalt und liegt in der Tabelle `budgets`, nicht im Browser-Speicher. Sonst
 * hätte jedes Familienmitglied ein anderes Budget vor Augen.
 *
 * Und seit Schritt 15 auch kein Schalter für die Bon-Fotos mehr. Er stand für
 * eine Wahl, die es gar nicht gibt: **Das Foto wird nach der Erkennung immer
 * verworfen und nie hochgeladen** (PROJEKT.md). Es gibt keinen Storage-Bucket,
 * `receipts.image_path` bleibt null — der Schalter konnte an dem Verhalten nie
 * etwas ändern und behauptete trotzdem, es zu tun. Ein Schalter ohne Wirkung ist
 * schlimmer als keiner, weil man ihm glaubt.
 *
 * Übrig bleibt genau eine Einstellung, die tatsächlich pro Gerät gilt: das
 * Erscheinungsbild.
 */
interface AppState {
  theme: Theme
  toggleTheme: () => void
}

const AppStateContext = createContext<AppState | null>(null)

const THEME_KEY = 'receipt-ai:theme'

/** Light is the default; a stored choice or the OS preference can override it. */
function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    // Keep the iOS status bar and Android chrome in step with the app background.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = theme === 'dark' ? '#0E1110' : '#F4F5F3'
    }
  }, [theme])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useAppState must be used inside <AppStateProvider>')
  return context
}
