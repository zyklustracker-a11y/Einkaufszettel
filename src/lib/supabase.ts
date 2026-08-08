import { createClient } from '@supabase/supabase-js'

/**
 * Der Supabase-Client der App.
 *
 * Beide Werte kommen aus der Umgebung und stehen nirgends im Code. Der anon-Key
 * darf im Browser stehen: Er schaltet nichts frei, was die Zugriffsregeln in der
 * Datenbank nicht ohnehin erlauben. Der Mistral-Schlüssel liegt später in einer
 * Edge Function und niemals hier (PROJEKT.md).
 */

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

/**
 * Gesetzt, wenn die Umgebungsvariablen fehlen. Der Anmelde-Screen zeigt das als
 * verständlichen Hinweis an, statt mit einer weißen Seite abzubrechen.
 */
export const supabaseConfigError: string | null =
  !url || !anonKey
    ? 'Die Verbindung zur Datenbank ist noch nicht eingerichtet. In der Datei .env fehlen VITE_SUPABASE_URL oder VITE_SUPABASE_ANON_KEY.'
    : null

/**
 * Basisadresse der Edge Functions, also `https://….supabase.co/functions/v1`.
 *
 * Die Bon-Erkennung wird bewusst mit einem gewöhnlichen `fetch` aufgerufen und
 * nicht über `supabase.functions.invoke`: Nur so kommen der HTTP-Status und der
 * Fehlertext der Funktion unverändert in der App an — und genau daraus entsteht
 * die deutsche Meldung, die der Nutzer sieht. `invoke` verpackt beides in einen
 * allgemeinen Fehler.
 */
export const functionsUrl = url ? `${url.replace(/\/+$/, '')}/functions/v1` : ''

/** Derselbe öffentliche Schlüssel, den auch der Client oben benutzt. */
export const supabaseAnonKey = anonKey ?? ''

export const supabase = createClient(
  // Platzhalter, damit das Anlegen des Clients nicht wirft, wenn die Werte
  // fehlen. Ohne sie kommt man ohnehin nicht über den Anmelde-Screen hinaus.
  url || 'https://nicht-konfiguriert.supabase.co',
  anonKey || 'nicht-konfiguriert',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      /*
       * Nach der Rückkehr von Google steht ein einmaliger Code in der Adresse.
       * Diese Einstellung tauscht ihn gegen eine Sitzung und räumt die Adresse
       * anschließend auf — sonst bliebe der Code in der Chronik stehen.
       */
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  },
)
