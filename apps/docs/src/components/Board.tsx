import type { ReactNode } from 'react'
import { DIAGRAM_SIZE, diagramKey } from './diagramKey'

/**
 * A Go diagram drawn with the game's board and stones, from rows of
 * characters, one per point:
 *   .  empty           X  black stone       O  white stone
 *   x  dead black      o  dead white        (faded, in the other's area)
 *   b  black's area    w  white's area      (a small square)
 *   *  a marked point (a liberty, or the point a move is played on)
 *   1–9 a numbered black stone, A–I a numbered white stone (A = 1)
 *
 * The image is rendered ahead of time by the game's own BoardCanvas, zoomed
 * in on the diagram's stones: after adding or changing a diagram, run
 * `npm run diagrams:docs --prefix apps/web`.
 */
type Props = { rows: string[]; caption?: string; size?: number }

export function Board({ rows, caption, size = DIAGRAM_SIZE }: Props) {
  return (
    <figure className="docs-board" style={{ width: size }}>
      <img
        src={`/diagrams/${diagramKey(rows, size)}.png`}
        width={size}
        height={size}
        alt={caption ?? 'Go diagram'}
        loading="lazy"
        decoding="async"
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  )
}

/** Diagrams side by side, wrapping on narrow screens. */
export function Boards({ children }: { children: ReactNode }) {
  return <div className="docs-boards">{children}</div>
}
