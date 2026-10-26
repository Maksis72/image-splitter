// Image Splitter demo: split a picture into A4 or Letter pages and print it as a big poster (one PDF), or cut it
// into equal pieces (one ZIP). Everything happens in the browser; nothing is uploaded.
// Full version with standard poster sizes, a wall preview, color dots and an assembly map:
// https://onepieceposter.com/image-splitter/

import { localPaper, MM, PAPERS, PdfDoc } from './pdf'
import { dotMap, drawDots, type DotMap } from './halftone'
import { piece, tiles, type Tiles } from './tiles'
import { zip } from './zip'

const $ = <E extends HTMLElement>(id: string) => document.getElementById(id) as E
const file = $<HTMLInputElement>('file')
const drop = $('drop')
const paper = $<HTMLSelectElement>('paper')
const orient = $<HTMLSelectElement>('orient')
const across = $<HTMLSelectElement>('across')
const style = $<HTMLSelectElement>('style')
const dot = $<HTMLSelectElement>('dot')
const preview = $<HTMLCanvasElement>('preview')
const info = $('info')
const pdfBtn = $<HTMLButtonElement>('pdf')
const cols = $<HTMLInputElement>('cols')
const rows = $<HTMLInputElement>('rows')
const zipBtn = $<HTMLButtonElement>('zip')
const status = $('status')

const MARGIN = 10 * MM
let image: ImageBitmap | null = null
let dots: (DotMap & { key: string }) | null = null

function layout(): Tiles | null {
  if (!image) return null
  const [a, b] = PAPERS[paper.value]
  return tiles(image, orient.value === 'landscape' ? [b, a] : [a, b], MARGIN, Number(across.value))
}

function dotsFor(T: Tiles, pitch: number) {
  const key = `${T.poster[2]}x${T.poster[3]}@${pitch}`
  if (!dots || dots.key !== key) dots = { key, ...dotMap(image!, T.poster[2], T.poster[3], pitch) }
  return dots
}

/** Paints the part (x, y, w, h) of the pages, in points, into ctx at k pixels per point. */
function paint(ctx: CanvasRenderingContext2D, T: Tiles, x: number, y: number, w: number, h: number, k: number) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w * k, h * k)
  const [px, py, pw, ph] = T.poster
  const box = [Math.max(x, px), Math.max(y, py), Math.min(x + w, px + pw), Math.min(y + h, py + ph)]
  if (box[2] <= box[0] || box[3] <= box[1]) return
  const pitch = Number(dot.value) * MM
  if (style.value === 'dots' && pitch * k >= 2) {
    drawDots(ctx, dotsFor(T, pitch), pitch, px, py, box, x, y, k)
    return
  }
  // the photo (or dots too small to see on screen, which blend into the same picture)
  const sc = image!.width / pw
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image!, (box[0] - px) * sc, (box[1] - py) * sc, (box[2] - box[0]) * sc, (box[3] - box[1]) * sc,
    (box[0] - x) * k, (box[1] - y) * k, (box[2] - box[0]) * k, (box[3] - box[1]) * k)
}

function draw() {
  const T = layout()
  if (!T) return
  const gw = T.cols * T.cell[0]
  const gh = T.rows * T.cell[1]
  const box = preview.parentElement!.clientWidth || 480
  const dpr = window.devicePixelRatio || 1
  const s = Math.min(box / gw, 520 / gh)
  preview.width = Math.round(gw * s * dpr)
  preview.height = Math.round(gh * s * dpr)
  preview.style.width = `${Math.round(gw * s)}px`
  const ctx = preview.getContext('2d')!
  const k = s * dpr
  paint(ctx, T, 0, 0, gw, gh, k)
  // page outlines and numbers: 1 top left, then left to right, row by row
  ctx.setTransform(k, 0, 0, k, 0, 0)
  ctx.strokeStyle = 'rgba(179,38,30,.9)'
  ctx.lineWidth = 1.5 / s
  ctx.setLineDash([6 / s, 4 / s])
  ctx.font = `700 ${12 / s}px system-ui,sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let r = 0; r < T.rows; r++) {
    for (let c = 0; c < T.cols; c++) {
      ctx.strokeRect(c * T.cell[0], r * T.cell[1], T.cell[0], T.cell[1])
      const bx = c * T.cell[0] + 14 / s
      const by = r * T.cell[1] + 14 / s
      ctx.fillStyle = 'rgba(179,38,30,.92)'
      ctx.beginPath()
      ctx.arc(bx, by, 10 / s, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.fillText(String(r * T.cols + c + 1), bx, by)
    }
  }
  preview.hidden = false
  drop.classList.add('has-image')
  const inch = (v: number) => Math.round((v / 72) * 10) / 10
  const cm = (v: number) => Math.round(v / MM) / 10
  const dpi = Math.round(T.dpi)
  const quality = style.value === 'dots' ? 'dots look sharp from a few steps away'
    : dpi >= 150 ? `${dpi} DPI, sharp` : dpi >= 100 ? `${dpi} DPI, fine from a step away` : `${dpi} DPI, blurry up close`
  info.textContent = `${inch(T.poster[2])} x ${inch(T.poster[3])} in (${cm(T.poster[2])} x ${cm(T.poster[3])} cm) `
    + `on ${T.cols * T.rows} pages, ${T.cols} across and ${T.rows} down. Print quality: ${quality}.`
  cols.value ||= String(T.cols)
  rows.value ||= String(T.rows)
}

async function jpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
  if (!blob) throw new Error('jpeg')
  return new Uint8Array(await blob.arrayBuffer())
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 30000)
}

/** One PDF page per tile, the picture in the printable part, cut marks and the page number in the margin. */
async function makePdf() {
  const T = layout()
  if (!T || !image) return
  pdfBtn.disabled = true
  const doc = new PdfDoc()
  const n = T.cols * T.rows
  const dpi = style.value === 'dots' ? Math.min(300, Math.max(150, 8 / (Number(dot.value) / 25.4))) : Math.max(96, Math.min(200, T.dpi))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((T.cell[0] / 72) * dpi)
  canvas.height = Math.round((T.cell[1] / 72) * dpi)
  const ctx = canvas.getContext('2d')!
  const k = canvas.width / T.cell[0]
  try {
    for (let r = 0; r < T.rows; r++) {
      for (let c = 0; c < T.cols; c++) {
        const i = r * T.cols + c + 1
        status.textContent = `Making page ${i} of ${n}...`
        await new Promise((res) => setTimeout(res, 0))
        paint(ctx, T, c * T.cell[0], r * T.cell[1], T.cell[0], T.cell[1], k)
        const page = doc.addPage(T.page)
        const id = doc.addJpeg(await jpeg(canvas), canvas.width, canvas.height)
        doc.drawImage(page, id, T.margin, T.margin, T.cell[0], T.cell[1])
        for (const [x, y, dx, dy] of [[0, 0, -1, -1], [1, 0, 1, -1], [0, 1, -1, 1], [1, 1, 1, 1]]) {
          const cx = T.margin + x * T.cell[0]
          const cy = T.margin + y * T.cell[1]
          doc.line(page, cx + dx * MM, cy, cx + dx * 6 * MM, cy, 0.4, 0.3)
          doc.line(page, cx, cy + dy * MM, cx, cy + dy * 6 * MM, 0.4, 0.3)
        }
        doc.text(page, T.margin, T.margin / 2 - 3, 9, `Page ${i} of ${n} (row ${r + 1}, column ${c + 1})`, 0.35)
      }
    }
    save(doc.save(), `poster-${T.cols}x${T.rows}-${paper.value}.pdf`)
    status.textContent = `Done: ${n} pages. Print at 100% (actual size), trim along the marks and tape them together.`
  } catch {
    status.textContent = 'This image could not be read. Try a JPG or PNG.'
  } finally {
    pdfBtn.disabled = false
  }
}

/** Image splitter: equal pieces of the original picture as JPG files in one ZIP. */
async function makePieces() {
  if (!image) return
  const count = (el: HTMLInputElement) => Math.max(1, Math.min(20, Math.round(Number(el.value)) || 1))
  const c = count(cols)
  const r = count(rows)
  zipBtn.disabled = true
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const files: { name: string; data: Uint8Array }[] = []
  try {
    for (let row = 0; row < r; row++) {
      for (let col = 0; col < c; col++) {
        status.textContent = `Cutting piece ${row * c + col + 1} of ${c * r}...`
        await new Promise((res) => setTimeout(res, 0))
        const p = piece(image, c, r, row, col)
        canvas.width = p.w
        canvas.height = p.h
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, p.w, p.h)
        ctx.drawImage(image, p.x, p.y, p.w, p.h, 0, 0, p.w, p.h)
        files.push({ name: `piece-${row + 1}-${col + 1}.jpg`, data: await jpeg(canvas) })
      }
    }
    save(zip(files), `image-split-${c}x${r}.zip`)
    status.textContent = `Done: ${c * r} pieces in one ZIP file.`
  } finally {
    zipBtn.disabled = false
  }
}

async function useFile(f: Blob | undefined) {
  if (!f) return
  try {
    image = await createImageBitmap(f)
  } catch {
    status.textContent = 'This image could not be read. Try a JPG or PNG.'
    return
  }
  dots = null
  cols.value = rows.value = ''
  pdfBtn.disabled = zipBtn.disabled = false
  draw()
}

paper.value = localPaper()
file.addEventListener('change', () => void useFile(file.files?.[0]))
drop.addEventListener('dragover', (e) => e.preventDefault())
drop.addEventListener('drop', (e) => {
  e.preventDefault()
  void useFile(e.dataTransfer?.files[0])
})
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
  if (item) void useFile(item.getAsFile() ?? undefined)
})
for (const el of [paper, orient, across, style, dot]) el.addEventListener('change', draw)
pdfBtn.addEventListener('click', () => void makePdf())
zipBtn.addEventListener('click', () => void makePieces())
window.addEventListener('resize', draw)
// the page opens with the example picture
fetch('assets/example.jpg').then((r) => (r.ok ? r.blob() : undefined)).then((b) => useFile(b)).catch(() => {})
