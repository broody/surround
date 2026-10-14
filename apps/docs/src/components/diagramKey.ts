/**
 * The file name of a rendered diagram, from what it shows and how big it's
 * drawn: an FNV-1a hash, so any change to a diagram renders a new image.
 * apps/web/scripts/docs-diagrams renders them; Board shows them.
 */
export function diagramKey(rows: readonly string[], size: number) {
  const text = `${size}\n${rows.map((row) => row.replace(/\s+/g, '')).join('\n')}`
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** The width diagrams are drawn at unless a page asks for another. */
export const DIAGRAM_SIZE = 200
