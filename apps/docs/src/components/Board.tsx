'use client'

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import type { BoardMark } from '../../../web/src/game/BoardCanvas'
import type { Position, Stone } from '../../../web/src/game/rules'
import type { BoardRegion } from '../../../web/src/game/region'

// The game's own board (Pixi, WebGL), loaded in the browser only: Pixi has no
// business on the server, and the page shows an empty frame until it's in.
const BoardCanvas = lazy(() => import('../../../web/src/game/BoardCanvas'))

/**
 * A Go diagram drawn with the game's board and stones, from rows of
 * characters, one per point:
 *   .  empty           X  black stone       O  white stone
 *   x  dead black      o  dead white        (faded, in the other's area)
 *   b  black's area    w  white's area      (a small square)
 *   *  a marked point (a liberty, or the point a move is played on)
 *   1–9 a numbered black stone, A–I a numbered white stone (A = 1)
 */
type Props = { rows: string[]; caption?: string; size?: number }

function diagram(rows: string[]) {
  const grid = rows.map((row) => row.replace(/\s+/g, '').split(''))
  const size = grid.length
  const board: Stone[] = []
  const marks: BoardMark[] = []
  const dead = new Set<number>()
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      const point = y * size + x
      const black = c === 'X' || c === 'x' || /[1-9]/.test(c)
      const white = c === 'O' || c === 'o' || /[A-I]/.test(c)
      board.push(black ? 1 : white ? 2 : 0)
      if (c === 'x' || c === 'o') {
        // A dead stone's point is its captor's area.
        dead.add(point)
        marks.push({ point, kind: 'area', color: c === 'x' ? 2 : 1 })
      }
      else if (/[1-9]/.test(c)) marks.push({ point, kind: 'label', text: c })
      else if (/[A-I]/.test(c))
        marks.push({ point, kind: 'label', text: String(c.charCodeAt(0) - 64) })
      else if (c === 'b' || c === 'w')
        marks.push({ point, kind: 'area', color: c === 'b' ? 1 : 2 })
      else if (c === '*') marks.push({ point, kind: 'circle' })
    }),
  )
  const position: Position = {
    board,
    turn: 1,
    captures: [0, 0],
    moves: [],
    hashes: [board.join('')],
    passes: 0,
    paused: false,
  }
  // Zoomed in on what the diagram is about, one line around it, as the
  // game's lessons do; a diagram that fills the board shows all of it.
  const shown = board.flatMap((stone, point) =>
    stone || marks.some((mark) => mark.point === point) ? [point] : [],
  )
  return { position, marks, dead, region: square(shown, size) }
}

/** A square window on `points`, one line around them and at least five
 * across, centered on them as far as the board's edges allow. */
function square(points: number[], size: number): BoardRegion {
  const cols = points.map((point) => point % size)
  const rows = points.map((point) => Math.floor(point / size))
  const bounds = (values: number[]) =>
    values.length ? [Math.min(...values) - 1, Math.max(...values) + 1] : [0, size - 1]
  const [left, right] = bounds(cols)
  const [top, bottom] = bounds(rows)
  const span = Math.min(size, Math.max(5, right - left + 1, bottom - top + 1))
  const fit = (lo: number, hi: number) => {
    const start = Math.round((lo + hi + 1 - span) / 2)
    const at = Math.max(0, Math.min(size - span, start))
    return [at, at + span - 1]
  }
  const [x0, x1] = fit(left, right)
  const [y0, y1] = fit(top, bottom)
  return { left: x0, top: y0, right: x1, bottom: y1 }
}

const noop = () => {}

export function Board({ rows, caption, size = 200 }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { position, marks, dead, region } = diagram(rows)
  const frame = <div className="board-canvas" aria-hidden="true" />
  return (
    <figure className="docs-board" style={{ width: size }}>
      {mounted ? (
        <Suspense fallback={frame}>
          <BoardCanvas
            position={position}
            marks={marks}
            dead={dead}
            region={region}
            coordinates={false}
            readOnly
            description={caption}
            onPlay={noop}
            onHover={noop}
          />
        </Suspense>
      ) : (
        frame
      )}
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

/** Diagrams side by side, wrapping on narrow screens. */
export function Boards({ children }: { children: ReactNode }) {
  return <div className="docs-boards">{children}</div>
}
