import type { ReactNode } from 'react'
import type { CategorySlice } from '../lib/derive'
import { donutGradient, linePoints, polylinePoints } from '../lib/derive'
import { formatEuro, formatEuroWhole } from '../lib/format'
import styles from './charts.module.css'

/* ------------------------------------------------------------------- donut */

export function CategoryDonut({ slices, total }: { slices: CategorySlice[]; total: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <div className={styles.donut} style={{ background: donutGradient(slices) }} role="img" aria-label="Ausgaben pro Kategorie">
        <div className={styles.donutHole}>
          <div className={styles.donutValue}>{formatEuroWhole(total)}</div>
          <div className={styles.donutCaption}>{slices.length} Kategorien</div>
        </div>
      </div>
      <ul className={styles.legend}>
        {slices.map((slice) => (
          <li key={slice.id} className={styles.legendRow}>
            <span className={styles.swatch} style={{ background: slice.color }} />
            <span className={styles.legendName}>{slice.name}</span>
            <span className={styles.legendValue}>{formatEuro(slice.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* --------------------------------------------------------------- sparkline */

/**
 * Line chart with a dot per data point. A dashed midline is drawn for price
 * histories, where "above or below the middle" is the thing worth seeing.
 */
export function Sparkline({
  values,
  height,
  midline = false,
  label,
}: {
  values: number[]
  height: number
  midline?: boolean
  label: string
}) {
  const width = 300
  const baseline = height - 10
  const points = linePoints(values, width, baseline, 10)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={styles.sparkline}
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <line x1="0" y1={baseline} x2={width} y2={baseline} stroke="var(--line)" strokeWidth="1.5" />
      {midline && (
        <line
          x1="0"
          y1={baseline / 2}
          x2={width}
          y2={baseline / 2}
          stroke="var(--line)"
          strokeWidth="1"
          strokeDasharray="3 5"
        />
      )}
      <polyline
        points={polylinePoints(points)}
        fill="none"
        stroke="var(--green)"
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"      />
      {points.map((point, index) => (
        <circle
          key={index}
          cx={point.x}
          cy={point.y}
          r="3.4"
          fill="var(--card)"
          stroke="var(--green)"
          strokeWidth="2.2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  )
}

export function SparkAxis({ children }: { children: ReactNode }) {
  return <div className={styles.sparkAxis}>{children}</div>
}

/* ---------------------------------------------------------------- barChart */

export interface Bar {
  label: string
  amount: number
}

/** Vertical bars. Anything above `overThreshold` turns red — the budget breach. */
export function BarChart({ bars, overThreshold }: { bars: Bar[]; overThreshold?: number }) {
  const max = Math.max(...bars.map((b) => b.amount)) || 1

  return (
    <div className={styles.bars}>
      {bars.map((bar) => {
        const isEmpty = bar.amount === 0
        const isOver = overThreshold !== undefined && bar.amount > overThreshold
        const modifier = isEmpty ? styles['bar--empty'] : isOver ? styles['bar--over'] : ''
        return (
          <div key={bar.label} className={styles.barColumn}>
            <div className={styles.barValue}>{isEmpty ? '–' : formatEuroWhole(bar.amount)}</div>
            {/* 4px keeps empty periods visible as a hairline rather than nothing. */}
            <div className={`${styles.bar} ${modifier}`} style={{ height: Math.max(4, Math.round((bar.amount / max) * 96)) }} />
            <div className={styles.barLabel}>{bar.label}</div>
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------- horizontal bars */

export function CategoryBars({ slices }: { slices: CategorySlice[] }) {
  const max = Math.max(...slices.map((s) => s.amount)) || 1

  return (
    <div className={styles.rows}>
      {slices.map((slice) => (
        <div key={slice.id} className={styles.row}>
          <div className={styles.rowName}>{slice.name}</div>
          <div className={styles.rowTrack}>
            <div
              className={styles.rowFill}
              style={{ width: `${((slice.amount / max) * 100).toFixed(1)}%`, background: slice.color }}
            />
          </div>
          <div className={styles.rowValue}>{formatEuro(slice.amount)}</div>
        </div>
      ))}
    </div>
  )
}
