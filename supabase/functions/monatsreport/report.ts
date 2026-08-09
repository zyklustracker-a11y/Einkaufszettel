/**
 * Aus Zahlen wird ein Satz.
 *
 * Die Sicht `v_last_month_report` liefert Beträge und Anzahlen; hier entstehen
 * daraus die zwei Zeilen, die auf dem Sperrbildschirm stehen. Dieselbe Linie wie
 * überall (PROJEKT.md: Formatierung nur in der Anzeige) — und mit einem zweiten
 * Nutzen: Ein Satz, der im Code entsteht, lässt sich mit Tests festnageln.
 *
 * Reine Funktionen über Zahlen, ohne Netz und ohne Datenbank.
 *
 * **Eine Push-Benachrichtigung hat wenig Platz.** iOS zeigt einen Titel und rund
 * zwei Zeilen Text; alles darüber wird abgeschnitten. Deshalb steht hier genau
 * das, was man im Vorbeigehen wissen will: Was hat der Monat gekostet, und war
 * das viel oder wenig? Alles Weitere findet man in der App — und dorthin führt
 * ein Tipp auf die Meldung.
 */

export interface ReportNumbers {
  month: string
  foodCents: number
  diningCents: number
  nonfoodCents: number
  totalCents: number
  receiptCount: number
  budgetCents: number
  previousTotalCents: number
  topProductName: string | null
  topProductCents: number
  savingsExcessCents: number
}

export interface Report {
  title: string
  body: string
}

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

/** `August 2026` — ohne `Intl`, weil die Zeitzone der Funktion nichts zur Sache tut. */
export function monthName(iso: string): string {
  const [year, month] = iso.split('-').map(Number)
  const name = MONTHS[month - 1] ?? ''
  return `${name} ${year}`
}

/** `1.234,56 €` — dieselbe Darstellung wie in der App. */
export function euro(cents: number): string {
  const sign = cents < 0 ? '−' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${sign}${whole},${String(abs % 100).padStart(2, '0')} €`
}

/**
 * Der Monatsreport, in zwei Zeilen.
 *
 * Der Aufbau ist immer derselbe, damit man ihn nach dem zweiten Mal überfliegen
 * kann: Gesamtsumme und Einkäufe, dann **eine** Einordnung. Welche das ist,
 * hängt davon ab, was tatsächlich zu sagen ist — und es wird nur eine gewählt,
 * nicht alle drei aneinandergehängt:
 *
 *   1. **Budget gerissen.** Das ist die wichtigste Nachricht, wenn es sie gibt.
 *   2. **Vergleich zum Vormonat**, sobald es einen Vormonat mit Ausgaben gibt.
 *   3. **Das teuerste Produkt** — die Auskunft, die immer geht.
 *
 * Ohne Vormonat wird nicht verglichen: „100 % mehr als im Vormonat" ist bei
 * einem leeren Vormonat richtig gerechnet und trotzdem Unsinn.
 */
export function buildReport(numbers: ReportNumbers): Report {
  const title = `${monthName(numbers.month)}: ${euro(numbers.totalCents)}`

  const parts: string[] = [
    `${numbers.receiptCount} ${numbers.receiptCount === 1 ? 'Einkauf' : 'Einkäufe'}`,
    `Lebensmittel ${euro(numbers.foodCents)}`,
  ]

  if (numbers.budgetCents > 0 && numbers.totalCents > numbers.budgetCents) {
    parts.push(`${euro(numbers.totalCents - numbers.budgetCents)} über Budget`)
  } else if (numbers.budgetCents > 0) {
    parts.push(`${euro(numbers.budgetCents - numbers.totalCents)} unter Budget`)
  } else if (numbers.previousTotalCents > 0) {
    const delta = numbers.totalCents - numbers.previousTotalCents
    parts.push(
      delta === 0
        ? 'genau wie im Vormonat'
        : `${euro(Math.abs(delta))} ${delta > 0 ? 'mehr' : 'weniger'} als im Vormonat`,
    )
  } else if (numbers.topProductName) {
    parts.push(`am teuersten: ${numbers.topProductName}`)
  }

  return { title, body: parts.join(' · ') }
}
