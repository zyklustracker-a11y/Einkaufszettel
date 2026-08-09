/**
 * Edge Function „monatsreport" — verschickt die Monatsmeldung.
 *
 * ---------------------------------------------------------------------------
 * WER RUFT SIE AUF
 * ---------------------------------------------------------------------------
 *
 * Ein Zeitplan in GitHub Actions, am zweiten Tag jedes Monats
 * (`.github/workflows/monatsreport.yml`). Nicht am ersten: Ein Bon vom Monatsende
 * wird oft erst am nächsten Tag gescannt, und ein Report, der ihn nicht enthält,
 * müsste sich später korrigieren.
 *
 * Die Anfrage trägt ein gemeinsames Geheimnis im Kopf `x-report-secret`. Ohne
 * das antwortet die Funktion mit 401 — sonst könnte jeder, der die Adresse
 * kennt, allen Familienmitgliedern eine Meldung schicken.
 *
 * ---------------------------------------------------------------------------
 * WARUM DIESE FUNKTION ALS EINZIGE EINEN DIENSTSCHLÜSSEL BENUTZT
 * ---------------------------------------------------------------------------
 *
 * PROJEKT.md hält fest, dass die Bon-Erkennung mit dem Token des **Nutzers**
 * arbeitet und nie mit einem Dienstschlüssel. Hier geht das nicht: Ein
 * Zeitplan hat keinen angemeldeten Nutzer, und die Funktion muss die Abos aller
 * Haushalte lesen können, um überhaupt jemanden zu erreichen.
 *
 * Die Abweichung ist deshalb so eng wie möglich gefasst:
 *
 *   * Sie **gibt nichts zurück** außer einer Zählung. Wer sie aufruft, erfährt
 *     nichts über Haushalte, Beträge oder Adressen.
 *   * Sie **liest** nur `push_subscriptions` und `v_last_month_report` und
 *     **schreibt** nur den Sendevermerk.
 *   * Ohne das gemeinsame Geheimnis kommt sie über Schritt 1 nicht hinaus.
 *
 * ---------------------------------------------------------------------------
 * WAS SIE NICHT TUT
 * ---------------------------------------------------------------------------
 *
 * Sie ruft **kein Modell** auf. Der Report ist eine Addition über Zahlen, die
 * längst in der Datenbank stehen — genau der Fall, für den PROJEKT.md
 * ausdrücklich verbietet, ein Modell zu fragen.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encryptPayload, vapidHeader } from './push.ts'
import type { PushSubscription } from './push.ts'
import { buildReport } from './report.ts'
import type { ReportNumbers } from './report.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-report-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

interface SubscriptionRow {
  id: string
  household_id: string
  endpoint: string
  p256dh: string
  auth: string
  last_month: string | null
}

interface ReportRow {
  household_id: string
  month: string
  food_cents: number
  dining_cents: number
  nonfood_cents: number
  total_cents: number
  receipt_count: number
  budget_cents: number
  previous_total_cents: number
  top_product_name: string | null
  top_product_cents: number
  savings_excess_cents: number
}

function toNumbers(row: ReportRow): ReportNumbers {
  return {
    month: row.month,
    foodCents: Number(row.food_cents),
    diningCents: Number(row.dining_cents),
    nonfoodCents: Number(row.nonfood_cents),
    totalCents: Number(row.total_cents),
    receiptCount: Number(row.receipt_count),
    budgetCents: Number(row.budget_cents),
    previousTotalCents: Number(row.previous_total_cents),
    topProductName: row.top_product_name,
    topProductCents: Number(row.top_product_cents),
    savingsExcessCents: Number(row.savings_excess_cents),
  }
}

/**
 * Eine Nachricht an ein Gerät.
 *
 * `TTL` sagt dem Push-Dienst, wie lange er es versuchen soll: drei Tage. Ein
 * Monatsreport, der nach einer Woche ankommt, wäre keine Nachricht mehr; ein
 * Telefon, das übers Wochenende aus war, soll ihn aber noch bekommen.
 */
async function send(
  subscription: PushSubscription,
  payload: string,
  vapid: { publicKey: string; privateKey: string; subject: string },
): Promise<{ ok: boolean; status: number }> {
  const body = await encryptPayload(subscription, payload)
  const authorization = await vapidHeader(
    subscription.endpoint,
    vapid,
    Math.floor(Date.now() / 1000),
  )

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '259200',
      Urgency: 'normal',
    },
    body: body as BodyInit,
  })

  return { ok: response.ok, status: response.status }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') {
    return json({ message: 'Diese Adresse nimmt nur POST-Anfragen entgegen.' }, 405)
  }

  /* ------------------------------------------------ 1. Das Geheimnis */

  const expected = Deno.env.get('REPORT_SECRET')
  if (!expected) {
    return json({ message: 'In Supabase fehlt das Secret REPORT_SECRET.' }, 500)
  }
  if (request.headers.get('x-report-secret') !== expected) {
    return json({ message: 'Nicht berechtigt.' }, 401)
  }

  const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    return json(
      { message: 'In Supabase fehlen VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY oder VAPID_SUBJECT.' },
      500,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json({ message: 'Die Funktion ist nicht vollständig eingerichtet.' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  /* ------------------------------------------- 2. Zahlen und Empfänger */

  const [reports, subscriptions] = await Promise.all([
    supabase
      .from('v_last_month_report')
      .select(
        'household_id, month, food_cents, dining_cents, nonfood_cents, total_cents, receipt_count, budget_cents, previous_total_cents, top_product_name, top_product_cents, savings_excess_cents',
      ),
    supabase
      .from('push_subscriptions')
      .select('id, household_id, endpoint, p256dh, auth, last_month')
      .is('failed_at', null),
  ])

  if (reports.error || subscriptions.error) {
    console.error('Report konnte nicht geladen werden:', reports.error ?? subscriptions.error)
    return json({ message: 'Die Daten für den Report konnten nicht geladen werden.' }, 500)
  }

  const byHousehold = new Map<string, ReportRow>()
  for (const row of (reports.data ?? []) as unknown as ReportRow[]) {
    byHousehold.set(row.household_id, row)
  }

  let sent = 0
  let skipped = 0
  let failed = 0

  for (const row of (subscriptions.data ?? []) as unknown as SubscriptionRow[]) {
    const report = byHousehold.get(row.household_id)

    /*
     * Kein Report heißt: Der Haushalt hat im Vormonat nichts erfasst. „Du hast
     * 0 € ausgegeben" ist keine Nachricht, sondern eine Störung.
     */
    if (!report) {
      skipped++
      continue
    }

    // Schon geschickt. Ein zweiter Lauf im selben Monat wiederholt nichts.
    if (row.last_month !== null && row.last_month >= report.month) {
      skipped++
      continue
    }

    const { title, body } = buildReport(toNumbers(report))
    const payload = JSON.stringify({ title, body, url: '/analysen' })

    try {
      const result = await send(
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload,
        { publicKey: vapidPublic, privateKey: vapidPrivate, subject: vapidSubject },
      )

      if (result.ok) {
        await supabase.rpc('mark_report_sent', {
          p_endpoint: row.endpoint,
          p_month: report.month,
        })
        sent++
        continue
      }

      /*
       * 404 und 410 heißen: Dieses Abo gibt es nicht mehr — die App wurde
       * gelöscht oder die Berechtigung entzogen. Das ist kein Fehler, sondern
       * eine Auskunft, und sie wird vermerkt statt bei jedem Lauf neu erzeugt.
       */
      await supabase
        .from('push_subscriptions')
        .update({
          failed_at: new Date().toISOString(),
          fail_reason:
            result.status === 404 || result.status === 410
              ? 'Abo abgelaufen'
              : `Push-Dienst antwortete mit ${result.status}`,
        })
        .eq('id', row.id)
      failed++
    } catch (cause) {
      console.error('Senden fehlgeschlagen:', cause)
      failed++
    }
  }

  // Zurück kommt nur eine Zählung — nichts über Haushalte, Beträge oder Geräte.
  return json({ sent, skipped, failed }, 200)
})
