import { supabase } from '../lib/supabase'
import { DataError, unwrap, unwrapMaybe } from './client'
import { reference } from './reference'

/**
 * Haushalt und Einladungen.
 *
 * Beim ersten Login bekommt **jeder** Nutzer einen eigenen Haushalt — anders
 * ginge es nicht, ohne Haushalt gäbe keine einzige Abfrage eine Zeile zurück.
 * Meldet sich die Familie an, sitzt danach jeder in seinem eigenen, leeren
 * Haushalt. Diese Datei ist der Weg zusammen.
 *
 * **Ein Code zum Abtippen und kein Link.** Ein Link müsste den Code aus der
 * Adresszeile lesen, und nach dem Rücksprung von Google wäre er wieder weg — es
 * sei denn, die App legte ihn irgendwo ab. Für drei Familienmitglieder ist der
 * kürzere Weg: anmelden, Code eingeben, fertig. Vorlesen geht auch.
 */

export interface HouseholdMember {
  userId: string
  name: string
  email: string
  role: string
  joinedAt: string
  isSelf: boolean
}

interface MemberRow {
  user_id: string
  name: string
  email: string
  role: string
  joined_at: string
  is_self: boolean
}

/**
 * Die Mitglieder des eigenen Haushalts.
 *
 * Über eine Funktion mit erhöhten Rechten, weil die E-Mail-Adressen in
 * `auth.users` stehen — dorthin kommt eine gewöhnliche Abfrage nicht. Die
 * Funktion prüft als Allererstes, ob der Aufrufer selbst dazugehört.
 */
export async function getHouseholdMembers(): Promise<HouseholdMember[]> {
  const { data, error } = await supabase.rpc('household_members_list')

  if (error) {
    throw new DataError(
      'Die Mitglieder konnten nicht geladen werden. Fehlt noch die Migration ' +
        'supabase/migrations/0010_einladungen.sql?',
    )
  }

  return ((data ?? []) as MemberRow[]).map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    joinedAt: row.joined_at,
    isSelf: row.is_self,
  }))
}

export interface Invite {
  code: string
  expiresAt: string
}

/** Der gültige Code des Haushalts, falls es einen gibt. Legt keinen an. */
export async function getInvite(): Promise<Invite | null> {
  const row = unwrapMaybe(
    await supabase
      .from('household_invites')
      .select('code, expires_at')
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ) as { code: string; expires_at: string } | null

  return row ? { code: row.code, expiresAt: row.expires_at } : null
}

/**
 * Einen Code erzeugen — oder den vorhandenen zurückgeben.
 *
 * `fresh` zieht den alten ausdrücklich zurück. Zwei gültige Codes nebeneinander
 * wären genau die Unklarheit, die es zu vermeiden gilt: Man wüsste nicht mehr,
 * welcher an wen ging.
 */
export async function createInvite(fresh = false): Promise<Invite> {
  const { data, error } = await supabase.rpc('create_household_invite', { p_new: fresh })

  if (error || typeof data !== 'string') {
    throw new DataError(
      'Der Einladungscode konnte nicht erzeugt werden. Fehlt noch die Migration ' +
        'supabase/migrations/0010_einladungen.sql?',
    )
  }

  const invite = await getInvite()
  return invite ?? { code: data, expiresAt: '' }
}

/** Den Code zurückziehen. Danach kann niemand mehr damit beitreten. */
export async function revokeInvite(): Promise<void> {
  const { error } = await supabase
    .from('household_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('household_id', reference().householdId)
    .is('revoked_at', null)

  if (error) throw new DataError('Der Code konnte nicht zurückgezogen werden.')
}

/**
 * Einem Haushalt beitreten.
 *
 * Die Funktion in der Datenbank löst dabei den eigenen, **leeren** Haushalt auf.
 * Enthält er schon Bons, lehnt sie ab — und ihre Meldung sagt, wie viele es
 * sind. Zusammenführen wäre die Alternative und ist bewusst nicht gebaut: Sie
 * müsste Produkte, Zuordnungen, Händler und Kategorien zweier Haushalte
 * verschmelzen, und ein Fehler dabei wäre nicht rückgängig zu machen.
 *
 * Der geworfene Text kommt aus der Datenbank und ist schon auf Deutsch — das ist
 * die einzige Stelle, an der eine Postgres-Meldung absichtlich durchgereicht
 * wird, weil sie eine Zahl enthält, die nur dort bekannt ist.
 */
export async function joinHousehold(code: string): Promise<void> {
  const cleaned = code.trim().toUpperCase()
  if (cleaned === '') throw new DataError('Bitte den Einladungscode eingeben.')

  const { error } = await supabase.rpc('redeem_household_invite', { p_code: cleaned })

  if (error) {
    const message = `${error.message ?? ''}`
    throw new DataError(
      message.includes('Einkäufe') || message.includes('ungültig')
        ? message
        : 'Der Beitritt hat nicht geklappt. Bitte den Code prüfen und noch einmal versuchen.',
    )
  }
}

/**
 * Wie viele Bons im eigenen Haushalt liegen.
 *
 * Der Beitritts-Screen sagt damit **vorher**, was passieren wird: Bei null Bons
 * wird der eigene Haushalt aufgelöst, sonst wird abgelehnt. Diese Auskunft
 * vorher zu geben ist besser, als sie als Fehlermeldung nachzureichen.
 */
export async function getOwnReceiptCount(): Promise<number> {
  const rows = unwrap<Array<{ receipt_count: number }>>(
    await supabase.from('v_household_stats').select('receipt_count'),
  )
  return rows[0]?.receipt_count ?? 0
}
