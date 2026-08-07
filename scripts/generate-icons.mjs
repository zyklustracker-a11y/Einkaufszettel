// Rasterises the Receipt AI mark (green squircle + receipt glyph) into the PNGs
// iOS and the web app manifest need. Run with `node scripts/generate-icons.mjs`.
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const GREEN = [0x16, 0x91, 0x5c]
const WHITE = [0xff, 0xff, 0xff]

/** Coverage of a rounded rect at a point, sampled 3x3 for anti-aliasing. */
function roundedRectCoverage(px, py, x, y, w, h, r) {
  let hits = 0
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const cx = px + (sx + 0.5) / 3
      const cy = py + (sy + 0.5) / 3
      if (cx < x || cy < y || cx > x + w || cy > y + h) continue
      // Distance from the nearest corner centre, clamped into the straight edges.
      const qx = Math.max(x + r - cx, cx - (x + w - r), 0)
      const qy = Math.max(y + r - cy, cy - (y + h - r), 0)
      if (qx * qx + qy * qy <= r * r) hits++
    }
  }
  return hits / 9
}

function blend(buf, i, color, alpha) {
  if (alpha <= 0) return
  for (let c = 0; c < 3; c++) {
    buf[i + c] = Math.round(buf[i + c] * (1 - alpha) + color[c] * alpha)
  }
}

function renderIcon(size) {
  const px = new Uint8Array(size * size * 3)
  // Shapes are authored on a 192px grid and scaled to the requested size.
  const k = size / 192
  const shapes = [
    // green app tile
    { rect: [0, 0, 192, 192], r: 42, color: GREEN },
    // receipt outline, drawn as four white bars so it stays crisp at 180px
    { rect: [50, 40, 92, 8], r: 4, color: WHITE },
    { rect: [50, 144, 92, 8], r: 4, color: WHITE },
    { rect: [50, 40, 8, 112], r: 4, color: WHITE },
    { rect: [134, 40, 8, 112], r: 4, color: WHITE },
    // receipt lines
    { rect: [70, 68, 52, 8], r: 4, color: WHITE },
    { rect: [70, 92, 52, 8], r: 4, color: WHITE },
    { rect: [70, 116, 30, 8], r: 4, color: WHITE },
  ]

  for (const { rect, r, color } of shapes) {
    const [x, y, w, h] = rect.map((v) => v * k)
    const rr = r * k
    const x0 = Math.max(0, Math.floor(x)), x1 = Math.min(size, Math.ceil(x + w))
    const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(size, Math.ceil(y + h))
    for (let py = y0; py < y1; py++) {
      for (let pxx = x0; pxx < x1; pxx++) {
        const a = roundedRectCoverage(pxx, py, x, y, w, h, rr)
        blend(px, (py * size + pxx) * 3, color, a)
      }
    }
  }
  return px
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let b = 0; b < 8; b++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgb, size) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  // raw scanlines, each prefixed with filter type 0
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let y = 0; y < size; y++) {
    const at = y * (size * 3 + 1)
    raw[at] = 0
    Buffer.from(rgb.buffer, y * size * 3, size * 3).copy(raw, at + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT, { recursive: true })
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(OUT, name), encodePng(renderIcon(size), size))
  console.log(`wrote ${name} (${size}×${size})`)
}
