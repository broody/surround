import type { ReactNode } from 'react'

/**
 * A Go board diagram from rows of characters, one per point:
 *   .  empty           X  black stone       O  white stone
 *   x  dead black      o  dead white        (drawn faded, crossed)
 *   b  black's area    w  white's area      (a small square)
 *   *  a marked point (a liberty, or the point a move is played on)
 *   1–9 a numbered black stone, A–I a numbered white stone (A = 1)
 */
type Props = { rows: string[]; caption?: string; size?: number }

const CELL = 24
const PAD = 18

export function Board({ rows, caption, size = 220 }: Props) {
  const grid = rows.map((row) => row.replace(/\s+/g, '').split(''))
  const h = grid.length
  const w = grid[0]?.length ?? 0
  const width = (w - 1) * CELL + PAD * 2
  const height = (h - 1) * CELL + PAD * 2
  const at = (i: number) => PAD + i * CELL
  const lines = []
  for (let y = 0; y < h; y++)
    lines.push(<line key={`h${y}`} x1={at(0)} x2={at(w - 1)} y1={at(y)} y2={at(y)} />)
  for (let x = 0; x < w; x++)
    lines.push(<line key={`v${x}`} y1={at(0)} y2={at(h - 1)} x1={at(x)} x2={at(x)} />)
  const marks = grid.flatMap((row, y) =>
    row.map((c, x) => {
      const cx = at(x)
      const cy = at(y)
      const key = `${x},${y}`
      const black = c === 'X' || c === 'x' || /[1-9]/.test(c)
      const white = c === 'O' || c === 'o' || /[A-I]/.test(c)
      if (black || white) {
        const dead = c === 'x' || c === 'o'
        const label = /[1-9]/.test(c) ? c : /[A-I]/.test(c) ? String(c.charCodeAt(0) - 64) : ''
        return (
          <g key={key} opacity={dead ? 0.45 : 1}>
            <circle
              cx={cx}
              cy={cy}
              r={CELL * 0.46}
              fill={black ? '#1b1b1d' : '#f4f1ea'}
              stroke={black ? '#000' : '#8a8172'}
              strokeWidth={1}
            />
            {dead && (
              <path
                d={`M${cx - 5} ${cy - 5}L${cx + 5} ${cy + 5}M${cx + 5} ${cy - 5}L${cx - 5} ${cy + 5}`}
                stroke="#c0392b"
                strokeWidth={2}
              />
            )}
            {label && (
              <text
                x={cx}
                y={cy}
                fill={black ? '#f4f1ea' : '#1b1b1d'}
                fontSize={12}
                fontFamily="ui-monospace, monospace"
                textAnchor="middle"
                dominantBaseline="central"
              >
                {label}
              </text>
            )}
          </g>
        )
      }
      if (c === 'b' || c === 'w')
        return (
          <rect
            key={key}
            x={cx - 4.5}
            y={cy - 4.5}
            width={9}
            height={9}
            fill={c === 'b' ? '#1b1b1d' : '#f4f1ea'}
            stroke={c === 'b' ? '#000' : '#8a8172'}
          />
        )
      if (c === '*')
        return <circle key={key} cx={cx} cy={cy} r={5} fill="#c0392b" />
      return null
    }),
  )
  return (
    <figure style={{ margin: '1.25rem 0', display: 'inline-block', maxWidth: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={size}
        style={{ maxWidth: '100%', height: 'auto', display: 'block', borderRadius: 4 }}
        role="img"
        aria-label={caption ?? 'Go board diagram'}
      >
        <rect width={width} height={height} fill="#dcb779" />
        <g stroke="#6b5232" strokeWidth={1}>
          {lines}
        </g>
        {marks}
      </svg>
      {caption && (
        <figcaption style={{ fontSize: '0.85em', opacity: 0.75, marginTop: 6, maxWidth: size }}>
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

/** Diagrams side by side, wrapping on narrow screens. */
export function Boards({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>{children}</div>
}
