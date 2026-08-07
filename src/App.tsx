import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
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
import { SettingsScreen } from './screens/Settings'

/** Routes that sit behind the tab bar. The scan flow and settings are modal-ish. */
const TABBED = ['/', '/bestpreise', '/analysen', '/gesundheit', '/einkauf']

function showsTabBar(pathname: string): boolean {
  return TABBED.some((base) => (base === '/' ? pathname === '/' : pathname.startsWith(base)))
}

export function App() {
  const { pathname } = useLocation()

  return (
    <div className="app">
      <Routes>
        <Route path="/anmelden" element={<Login />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/scan" element={<ScanCamera />} />
        <Route path="/scan/verarbeitung" element={<ScanProcessing />} />
        <Route path="/scan/pruefen" element={<ScanReview />} />
        <Route path="/bestpreise" element={<Prices />} />
        <Route path="/bestpreise/:productId" element={<ProductDetail />} />
        <Route path="/analysen" element={<Analytics />} />
        <Route path="/gesundheit" element={<Health />} />
        <Route path="/einkauf/:receiptId" element={<PurchaseDetail />} />
        <Route path="/einstellungen" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {showsTabBar(pathname) && <TabBar />}
    </div>
  )
}
