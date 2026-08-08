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
 * Übrig bleiben zwei Einstellungen, die tatsächlich pro Gerät gelten: das
 * Erscheinungsbild und ob Bon-Fotos nach der Erkennung gelöscht werden.
 */
interface AppState {
  theme: Theme
  toggleTheme: () => void
  deleteReceiptPhotos: boolean
  toggleDeleteReceiptPhotos: () => void
}

const AppStateContext = createContext<AppState | null>(null)

const THEME_KEY = 'receipt-ai:theme'
const PHOTOS_KEY = 'receipt-ai:deleteReceiptPhotos'

/** Light is the default; a stored choice or the OS preference can override it. */
function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function initialDeletePhotos(): boolean {
  const stored = localStorage.getItem(PHOTOS_KEY)
  return stored === null ? true : stored === 'true'
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [deleteReceiptPhotos, setDeleteReceiptPhotos] = useState<boolean>(initialDeletePhotos)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    // Keep the iOS status bar and Android chrome in step with the app background.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = theme === 'dark' ? '#0E1110' : '#F4F5F3'
    }
  }, [theme])

  useEffect(() => {
    localStorage.setItem(PHOTOS_KEY, String(deleteReceiptPhotos))
  }, [deleteReceiptPhotos])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const toggleDeleteReceiptPhotos = useCallback(() => setDeleteReceiptPhotos((v) => !v), [])

  const value = useMemo(
    () => ({ theme, toggleTheme, deleteReceiptPhotos, toggleDeleteReceiptPhotos }),
    [theme, toggleTheme, deleteReceiptPhotos, toggleDeleteReceiptPhotos],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useAppState must be used inside <AppStateProvider>')
  return context
}
