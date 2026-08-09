/**
 * Icon set, traced from the prototype. All of them inherit `currentColor` and
 * are sized by their viewBox so they stay crisp at the sizes the design uses.
 */

export function GridIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 23 23" aria-hidden="true">
      <rect x="1.5" y="1.5" width="8.5" height="8.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="1.5" width="8.5" height="8.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="1.5" y="13" width="8.5" height="8.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="13" y="13" width="8.5" height="8.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

export function TagIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 23 23" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="17"
        height="17"
        rx="4"
        transform="rotate(45 11.5 11.5)"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="11.5" cy="11.5" r="2.6" fill="currentColor" />
    </svg>
  )
}

/**
 * Der Einkaufszettel: ein Blatt mit Häkchen.
 *
 * Bewusst kein Einkaufswagen — der stünde für „kaufen", und der Tab steht für
 * „aufschreiben und abhaken". Die Strichstärke ist dieselbe wie bei den vier
 * Nachbarn, sonst fiele er in der Leiste aus dem Rahmen.
 */
export function ListIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 23 23" aria-hidden="true">
      <rect x="3.5" y="1.5" width="16" height="20" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        d="M7.5 8.2 L9.3 10 L12.6 6.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 15.2 L9.3 17 L12.6 13.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="14.4" y="8.2" width="4" height="2" rx="1" fill="currentColor" />
      <rect x="14.4" y="15.2" width="4" height="2" rx="1" fill="currentColor" />
    </svg>
  )
}

export function BarsIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 23 23" aria-hidden="true">
      <rect x="1.5" y="12" width="5" height="9.5" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="9" y="6" width="5" height="15.5" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="16.5" y="1.5" width="5" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

export function HealthIcon() {
  return (
    <svg width="23" height="23" viewBox="0 0 23 23" aria-hidden="true">
      <circle cx="11.5" cy="11.5" r="9.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="10.2" y="6" width="2.6" height="11" rx="1.3" fill="currentColor" />
      <rect x="6" y="10.2" width="11" height="2.6" rx="1.3" fill="currentColor" />
    </svg>
  )
}

export function ScanIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <path
        d="M2 8V4.5A2.5 2.5 0 014.5 2H8M18 2h3.5A2.5 2.5 0 0124 4.5V8M24 18v3.5a2.5 2.5 0 01-2.5 2.5H18M8 24H4.5A2.5 2.5 0 012 21.5V18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <rect x="2" y="12" width="22" height="2.4" rx="1.2" fill="currentColor" />
    </svg>
  )
}

export function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="3.2" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle
        cx="10"
        cy="10"
        r="7.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="3.6 3.4"
      />
    </svg>
  )
}

export function ChevronLeftIcon() {
  return (
    <svg width="9" height="15" viewBox="0 0 9 15" aria-hidden="true">
      <path d="M8 1L2 7.5L8 14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

/** Der Weg nach vorn — in den Einstellungen rechts an jeder Bereichszeile. */
export function ChevronRightIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      <path
        d="M1.8 1.6 L8 8 L1.8 14.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="10" y="11" width="6" height="2" rx="1" transform="rotate(45 10 11)" fill="currentColor" />
    </svg>
  )
}

export function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="2" opacity=".25" />
      <circle cx="10" cy="10" r="4" fill="currentColor" />
    </svg>
  )
}

/** The app mark: a receipt outline with three text lines. */
export function ReceiptMark() {
  return (
    <svg width="34" height="40" viewBox="0 0 34 40" aria-hidden="true">
      <rect x="1.5" y="1.5" width="31" height="33" rx="4" fill="none" stroke="#fff" strokeWidth="3" />
      <rect x="8" y="10" width="18" height="3" rx="1.5" fill="#fff" />
      <rect x="8" y="18" width="18" height="3" rx="1.5" fill="#fff" />
      <rect x="8" y="26" width="11" height="3" rx="1.5" fill="#fff" />
    </svg>
  )
}
