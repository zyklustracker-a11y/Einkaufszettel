import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getDefaultSettings } from '../data'
import type { Settings } from '../types'

export type Theme = 'light' | 'dark'

interface AppState {
  theme: Theme
  toggleTheme: () => void
  settings: Settings
  setMonthlyBudgetCents: (value: number) => void
  toggleDeleteReceiptPhotos: () => void
}

const AppStateContext = createContext<AppState | null>(null)

const THEME_KEY = 'receipt-ai:theme'
const SETTINGS_KEY = 'receipt-ai:settings'

/** Light is the default; a stored choice or the OS preference can override it. */
function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function initialSettings(): Settings {
  const stored = localStorage.getItem(SETTINGS_KEY)
  if (!stored) return getDefaultSettings()
  try {
    return { ...getDefaultSettings(), ...(JSON.parse(stored) as Partial<Settings>) }
  } catch {
    return getDefaultSettings()
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [settings, setSettings] = useState<Settings>(initialSettings)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
    // Keep the iOS status bar and Android chrome in step with the app background.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = theme === 'dark' ? '#0E1110' : '#F4F5F3'
    }
  }, [theme])

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  const toggleTheme = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])

  const setMonthlyBudgetCents = useCallback(
    (monthlyBudgetCents: number) => setSettings((s) => ({ ...s, monthlyBudgetCents })),
    [],
  )

  const toggleDeleteReceiptPhotos = useCallback(
    () => setSettings((s) => ({ ...s, deleteReceiptPhotos: !s.deleteReceiptPhotos })),
    [],
  )

  const value = useMemo(
    () => ({ theme, toggleTheme, settings, setMonthlyBudgetCents, toggleDeleteReceiptPhotos }),
    [theme, toggleTheme, settings, setMonthlyBudgetCents, toggleDeleteReceiptPhotos],
  )

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState(): AppState {
  const context = useContext(AppStateContext)
  if (!context) throw new Error('useAppState must be used inside <AppStateProvider>')
  return context
}
