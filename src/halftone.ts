// Halftone dots, like the Rasterbator: round black dots on white, bigger where the picture is darker, every
// other row shifted by half a dot. The dots sit on one grid over the whole poster, so the pages fit together.

export interface DotMap {
  nx: number
  ny: number
  px: Uint8ClampedArray // RGBA, one pixel per dot cell
}

/** The picture shrunk towards w x h pixels in halves, so each pixel is close to the average of its area. */
function shrink(img: ImageBitmap, w: number, h: number): CanvasImageSource {
  let src: CanvasImageSource = img
  let sw = img.width
  let sh = img.height
  while (sw / 2 > w && sh / 2 > h) {
    sw = Math.round(sw / 2)
    sh = Math.round(sh / 2)
    const c = document.createElement('canvas')
    c.width = sw
    c.height = sh
    const x = c.getContext('2d')!
    x.imageSmoothingQuality = 'high'
    x.drawImage(src, 0, 0, sw, sh)
    src = c
  }
  return src
}

/** One averaged color per dot cell for a poster `width` x `height` points with dots every `pitch` points. */
export function dotMap(img: ImageBitmap, width: number, height: number, pitch: number): DotMap {
  const nx = Math.ceil(width / pitch) + 1 // one more for the shifted rows
  const ny = Math.ceil(height / pitch)
  const c = document.createElement('canvas')
  c.width = nx
  c.height = ny
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.fillStyle = '#fff'
  x.fillRect(0, 0, nx, ny)
  x.imageSmoothingQuality = 'high'
  x.drawImage(shrink(img, width / pitch, height / pitch), 0, 0, width / pitch, height / pitch)
  return { nx, ny, px: x.getImageData(0, 0, nx, ny).data }
}

/**
 * Draws the dots of the poster part (x0, y0)-(x1, y1) into ctx. The poster starts at (px, py); everything is in
 * points, drawn at k pixels per point with (ox, oy) at the canvas corner.
 */
export function drawDots(ctx: CanvasRenderingContext2D, D: DotMap, pitch: number, px: number, py: number,
  [x0, y0, x1, y1]: number[], ox: number, oy: number, k: number) {
  ctx.save()
  ctx.beginPath()
  ctx.rect((x0 - ox) * k, (y0 - oy) * k, (x1 - x0) * k, (y1 - y0) * k)
  ctx.clip()
  ctx.fillStyle = '#141414'
  ctx.beginPath()
  const i0 = Math.max(0, Math.floor((x0 - px) / pitch) - 1)
  const i1 = Math.min(D.nx - 2, Math.ceil((x1 - px) / pitch))
  const j0 = Math.max(0, Math.floor((y0 - py) / pitch) - 1)
  const j1 = Math.min(D.ny - 1, Math.ceil((y1 - py) / pitch))
  for (let j = j0; j <= j1; j++) {
    const shift = j % 2
    for (let i = i0; i <= i1; i++) {
      const o = (j * D.nx + i) * 4
      const lum = (p: number) => 0.2126 * D.px[p] + 0.7152 * D.px[p + 1] + 0.0722 * D.px[p + 2]
      const y = shift ? (lum(o) + lum(o + 4)) / 2 : lum(o) // a shifted dot sits between two cells
      const r = 0.6 * pitch * Math.sqrt((1 - y / 255) ** 1.3) * k
      if (r < 0.35) continue
      const cx = (px + (i + 0.5 + shift * 0.5) * pitch - ox) * k
      const cy = (py + (j + 0.5) * pitch - oy) * k
      ctx.moveTo(cx + r, cy)
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
    }
  }
  ctx.fill()
  ctx.restore()
}
