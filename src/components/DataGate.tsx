import { Outlet } from 'react-router-dom'
import { loadReference, useQuery } from '../data'
import { AppLoading } from './AppLoading'
import { ErrorCard } from './states'

/**
 * Lädt die Stammdaten des Haushalts, bevor irgendein angemeldeter Screen
 * erscheint.
 *
 * Kategorien, Merkmale und Händler werden in jeder Positionszeile und in jeder
 * Preiskarte gebraucht. Würde jede dieser Stellen selbst laden, hätte jede
 * Komponente ihren eigenen Ladezustand und der Screen flackerte in Teilen
 * hinein. Stattdessen einmal hier — danach sind `getCategory`, `getTraits` und
 * `getMerchantName` schlicht synchron.
 *
 * Fehlt die Verbindung oder die Migration, steht hier die Erklärung und ein
 * Knopf, statt einer weißen Seite.
 */
export function DataGate() {
  const state = useQuery(loadReference, [])

  if (state.error) {
    return (
      <div className="screen">
        <h1 className="pageTitle" style={{ marginBottom: 14 }}>
          Daten nicht erreichbar
        </h1>
        <ErrorCard message={state.error} onRetry={state.reload} />
      </div>
    )
  }

  if (!state.loaded) return <AppLoading />

  return <Outlet />
}
