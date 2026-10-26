// A small PDF writer for the browser: pages with JPEG or lossless RGB images, thin lines
// and Helvetica text. The file is built in memory; nothing is uploaded.

export type PageSize = [number, number] // PDF points, 1/72 inch
export const MM = 72 / 25.4
export const PAPERS: Record<string, PageSize> = {
  a4: [595.28, 841.89], letter: [612, 792], a3: [841.89, 1190.55], legal: [612, 1008], tabloid: [792, 1224],
}

/** US Letter where it is the usual paper, else A4. */
export function localPaper(): 'a4' | 'letter' {
  const region = (navigator.language.split('-')[1] ?? '').toUpperCase()
  return ['US', 'CA', 'MX', 'PH'].includes(region) ? 'letter' : 'a4'
}

interface PdfImage {
  data: Uint8Array
  width: number
  height: number
  filter: 'DCTDecode' | 'FlateDecode'
}

interface PdfPage {
  w: number
  h: number
  ops: string[]
  images: Set<number>
}

const num = (v: number) => String(Math.round(v * 100) / 100)

/** Windows-1252 codes of the WinAnsiEncoding characters beyond Latin-1 (the rest of Latin-1 keeps its code). */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '˜': 0x98,
  '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
}

/** A PDF hex string in WinAnsiEncoding, so accented letters (é, ü, ã, ç...) print; anything else becomes "?". */
function winAnsi(text: string) {
  return [...text].map((ch) => {
    const c = ch.codePointAt(0)!
    const b = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : (WIN_ANSI[ch] ?? 0x3f)
    return b.toString(16).padStart(2, '0')
  }).join('')
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // zlib format, which is what /FlateDecode expects
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export class PdfDoc {
  private pages: PdfPage[] = []
  private images: PdfImage[] = []

  addPage([w, h]: PageSize): number {
    this.pages.push({ w, h, ops: [], images: new Set() })
    return this.pages.length - 1
  }

  /** A JPEG goes in as it is (no re-encoding). */
  addJpeg(data: Uint8Array, width: number, height: number): number {
    this.images.push({ data, width, height, filter: 'DCTDecode' })
    return this.images.length - 1
  }

  /** 8-bit RGB pixels, stored losslessly. */
  async addRgb(pixels: Uint8Array, width: number, height: number): Promise<number> {
    this.images.push({ data: await deflate(pixels), width, height, filter: 'FlateDecode' })
    return this.images.length - 1
  }

  drawImage(page: number, image: number, x: number, y: number, w: number, h: number) {
    const p = this.pages[page]
    p.images.add(image)
    p.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /Im${image} Do Q`)
  }

  line(page: number, x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0) {
    this.pages[page].ops.push(`q ${gray} G ${width} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S Q`)
  }

  /** Helvetica text; the letters of Windows-1252 (western European languages). */
  text(page: number, x: number, y: number, size: number, text: string, gray = 0) {
    this.pages[page].ops.push(`BT ${gray} g /F1 ${size} Tf ${num(x)} ${num(y)} Td <${winAnsi(text)}> Tj ET`)
  }

  save(): Blob {
    const enc = new TextEncoder()
    const parts: Uint8Array[] = []
    const offsets: number[] = []
    let size = 0
    const push = (part: string | Uint8Array) => {
      const bytes = typeof part === 'string' ? enc.encode(part) : part
      parts.push(bytes)
      size += bytes.length
    }
    const obj = (n: number, body: string) => {
      offsets[n] = size
      push(`${n} 0 obj\n${body}\nendobj\n`)
    }
    // 1 catalog, 2 page tree, 3 font, then the images, then a page and its contents for every page
    const imageObj = (i: number) => 4 + i
    const pageObj = (i: number) => 4 + this.images.length + i * 2

    push('%PDF-1.4\n%âãÏÓ\n')
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
    obj(2, `<< /Type /Pages /Kids [${this.pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${this.pages.length} >>`)
    obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    this.images.forEach((im, i) => {
      offsets[imageObj(i)] = size
      push(`${imageObj(i)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${im.filter} /Length ${im.data.length} >>\nstream\n`)
      push(im.data)
      push('\nendstream\nendobj\n')
    })
    this.pages.forEach((p, i) => {
      const xobjects = [...p.images].map((im) => `/Im${im} ${imageObj(im)} 0 R`).join(' ')
      obj(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.w)} ${num(p.h)}] ` +
        `/Resources << /Font << /F1 3 0 R >> /XObject << ${xobjects} >> >> /Contents ${pageObj(i) + 1} 0 R >>`)
      const content = p.ops.join('\n')
      obj(pageObj(i) + 1, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`)
    })

    const count = 4 + this.images.length + this.pages.length * 2
    const xref = size
    const rows = offsets.slice(1, count).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    push(`xref\n0 ${count}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
    return new Blob(parts as BlobPart[], { type: 'application/pdf' })
  }
}
