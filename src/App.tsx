import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { AppLoading } from './components/AppLoading'
import { DataGate } from './components/DataGate'
import { TabBar } from './components/TabBar'
import { Analytics } from './screens/Analytics'
import { Dashboard } from './screens/Dashboard'
import { Health } from './screens/Health'
import { Login } from './screens/Login'
import { Prices } from './screens/Prices'
import { ProductDetail } from './screens/ProductDetail'
import { PurchaseDetail } from './screens/PurchaseDetail'
import { ScanCamera } from './screens/ScanCamera'
import { ScanProcessing } from './screens/ScanProcessing'
import { ScanReview } from './screens/ScanReview'
import { ShoppingListScreen } from './screens/ShoppingList'
import {
  BudgetSettingsScreen,
  CategorySettingsScreen,
  HouseholdSettingsScreen,
  SettingsScreen,
  TraitSettingsScreen,
} from './screens/Settings'
import { useAuth } from './state/AuthContext'

/** Routes that sit behind the tab bar. The scan flow and settings are modal-ish. */
const TABBED = ['/', '/bestpreise', '/zettel', '/analysen', '/gesundheit', '/einkauf']

/** Where an unauthenticated visitor is sent, and where a login lands. */
export const LOGIN_PATH = '/anmelden'

function showsTabBar(pathname: string): boolean {
  return TABBED.some((base) => (base === '/' ? pathname === '/' : pathname.startsWith(base)))
}

/** Everything inside is for signed-in users only. */
function RequireAuth() {
  const { status } = useAuth()
  return status === 'signedIn' ? <Outlet /> : <Navigate to={LOGIN_PATH} replace />
}

export function App() {
  const { status } = useAuth()
  const { pathname } = useLocation()

  /*
   * Solange die Sitzung geprüft wird, kommt weder eine Route noch die Tab-Leiste
   * zum Zug. Das ist der einzige Weg, sicher zu verhindern, dass beim Start kurz
   * die falsche Seite aufblitzt.
   */
  if (status === 'loading') {
    return (
      <div className="app">
        <AppLoading />
      </div>
    )
  }

  return (
    <div className="app">
      <Routes>
        {/* Wer angemeldet ist, hat auf dem Anmelde-Screen nichts zu suchen. */}
        <Route
          path={LOGIN_PATH}
          element={status === 'signedIn' ? <Navigate to="/" replace /> : <Login />}
        />

        {/*
          Erst Zugriffsschutz, dann Stammdaten: Ohne Anmeldung gibt es nichts zu
          laden, und ohne geladene Stammdaten kann kein Screen etwas anzeigen.
        */}
        <Route element={<RequireAuth />}>
          <Route element={<DataGate />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/scan" element={<ScanCamera />} />
            <Route path="/scan/verarbeitung" element={<ScanProcessing />} />
            <Route path="/scan/pruefen" element={<ScanReview />} />
            <Route path="/bestpreise" element={<Prices />} />
            <Route path="/bestpreise/:productId" element={<ProductDetail />} />
            <Route path="/zettel" element={<ShoppingListScreen />} />
            <Route path="/analysen" element={<Analytics />} />
            <Route path="/gesundheit" element={<Health />} />
            <Route path="/einkauf/:receiptId" element={<PurchaseDetail />} />
            {/*
              Bearbeiten führt in denselben Screen wie das Korrigieren nach dem
              Scan — er bringt die ganze Bearbeitungslogik ohnehin mit. Der
              Unterschied liegt allein in der Vorlage: hier ein gespeicherter
              Bon statt eines frisch erkannten, und beim Speichern wird
              aktualisiert statt angelegt.
            */}
            <Route path="/einkauf/:receiptId/bearbeiten" element={<ScanReview />} />
            {/*
              Die Einstellungen sind seit Schritt 11 eine Übersicht mit eigenen
              Screens dahinter — jeder mit Zurück-Weg, wie man es von iOS kennt.
              Eigene Routen und keine Zustandsumschaltung im Screen: Nur so
              funktioniert die Zurück-Geste des Browsers, und nur so lässt sich
              ein Bereich verlinken.
            */}
            <Route path="/einstellungen" element={<SettingsScreen />} />
            <Route path="/einstellungen/budget" element={<BudgetSettingsScreen />} />
            <Route path="/einstellungen/kategorien" element={<CategorySettingsScreen />} />
            <Route path="/einstellungen/merkmale" element={<TraitSettingsScreen />} />
            <Route path="/einstellungen/haushalt" element={<HouseholdSettingsScreen />} />
          </Route>
        </Route>

        {/*
          Unbekannte Adressen: angemeldet aufs Dashboard, sonst zur Anmeldung.
          Das fängt auch den Rücksprung von Google ab, falls er auf einer
          anderen Adresse landet als erwartet.
        */}
        <Route
          path="*"
          element={<Navigate to={status === 'signedIn' ? '/' : LOGIN_PATH} replace />}
        />
      </Routes>

      {status === 'signedIn' && showsTabBar(pathname) && <TabBar />}
    </div>
  )
}
