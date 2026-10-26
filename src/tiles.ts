// How a picture splits into printable pages: how many pages across and down, and where the picture sits on
// them. All sizes are PDF points (1/72 inch).

import type { PageSize } from './pdf'

export interface Tiles {
  page: PageSize // the paper, turned the chosen way
  margin: number // the white edge most printers cannot print
  cell: [number, number] // the printed part of one page
  cols: number
  rows: number
  poster: [number, number, number, number] // x, y, width, height of the picture on the pages
  dpi: number // picture pixels per inch of the printed poster
}

/** A picture printed `across` pages wide; it gets as many rows of pages as its height needs, centred on them. */
export function tiles(img: { width: number; height: number }, page: PageSize, margin: number, across: number): Tiles {
  const cell: [number, number] = [page[0] - 2 * margin, page[1] - 2 * margin]
  const w = across * cell[0]
  const h = (w * img.height) / img.width
  const rows = Math.max(1, Math.ceil(h / cell[1] - 1e-6))
  return {
    page, margin, cell, cols: across, rows,
    poster: [0, (rows * cell[1] - h) / 2, w, h],
    dpi: img.width / (w / 72),
  }
}

/** Equal pieces of a picture for an image splitter: pixel edges of piece (row, col) in a cols x rows split. */
export function piece(img: { width: number; height: number }, cols: number, rows: number, row: number, col: number) {
  const x0 = Math.round((col * img.width) / cols)
  const y0 = Math.round((row * img.height) / rows)
  return { x: x0, y: y0, w: Math.round(((col + 1) * img.width) / cols) - x0, h: Math.round(((row + 1) * img.height) / rows) - y0 }
}
