/**
 * Generates assets/icon.ico from scratch (no external deps, no image editor available in this
 * environment) — a simple flat-color square with a lighter "pulse" chevron, encoded as raw 32bpp
 * BGRA bitmaps wrapped in a standard ICO container. Produces 16/32/48/256px entries (256 stored as
 * PNG, matching the ICO spec's requirement for large images).
 *
 * This exists so `rcedit` has something real to stamp onto Argus.exe (Phase 7 "app icon +
 * version resource"); it is not intended to be a final brand asset — swap assets/icon.ico for a
 * designed one at any time and re-run `bun run compile` (no other code changes needed).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

const OUT = join(import.meta.dir, "..", "assets", "icon.ico");

const BG = [0x1e, 0x40, 0x66] as const; // dark slate-blue, BGR order for BMP
const FG = [0x4a, 0xd8, 0x7a] as const; // Argus accent green, BGR order

// Draws a simple upward "pulse" chevron (like a heartbeat blip) into an RGBA buffer.
function drawPulse(size: number): Buffer {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      px[i] = BG[2];
      px[i + 1] = BG[1];
      px[i + 2] = BG[0];
      px[i + 3] = 0xff;
    }
  }
  // Pulse line: a flat segment, a spike up, a spike down, a flat segment — classic ECG blip.
  const midY = Math.floor(size * 0.55);
  const thickness = Math.max(1, Math.round(size / 16));
  const points: [number, number][] = [
    [size * 0.08, midY],
    [size * 0.32, midY],
    [size * 0.44, size * 0.15],
    [size * 0.56, size * 0.85],
    [size * 0.68, midY],
    [size * 0.92, midY],
  ];
  for (let seg = 0; seg < points.length - 1; seg++) {
    const [x0, y0] = points[seg]!;
    const [x1, y1] = points[seg + 1]!;
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      for (let dy = -thickness; dy <= thickness; dy++) {
        for (let dx = -thickness; dx <= thickness; dx++) {
          const px_ = Math.round(cx + dx);
          const py_ = Math.round(cy + dy);
          if (px_ < 0 || py_ < 0 || px_ >= size || py_ >= size) continue;
          if (dx * dx + dy * dy > thickness * thickness) continue;
          const i = (py_ * size + px_) * 4;
          px[i] = FG[2];
          px[i + 1] = FG[1];
          px[i + 2] = FG[0];
          px[i + 3] = 0xff;
        }
      }
    }
  }
  return px;
}

function rgbaToBmpDib(rgba: Buffer, size: number): Buffer {
  // BITMAPINFOHEADER + XOR color data (BGRA, bottom-up) + AND mask (all zero = fully opaque via alpha)
  const headerSize = 40;
  const imageSize = size * size * 4;
  const maskRowBytes = Math.ceil(size / 8 / 4) * 4;
  const maskSize = maskRowBytes * size;

  const buf = Buffer.alloc(headerSize + imageSize + maskSize);
  buf.writeUInt32LE(headerSize, 0);
  buf.writeInt32LE(size, 4);
  buf.writeInt32LE(size * 2, 8); // height doubled per ICO/BMP-in-ICO convention (XOR + AND masks)
  buf.writeUInt16LE(1, 12); // planes
  buf.writeUInt16LE(32, 14); // bpp
  buf.writeUInt32LE(0, 16); // BI_RGB
  buf.writeUInt32LE(imageSize, 20);
  buf.writeInt32LE(0, 24);
  buf.writeInt32LE(0, 28);
  buf.writeUInt32LE(0, 32);
  buf.writeUInt32LE(0, 36);

  // Bottom-up row order for the XOR (color) plane.
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y;
    rgba.copy(buf, headerSize + y * size * 4, srcRow * size * 4, srcRow * size * 4 + size * 4);
  }
  // AND mask left as zero (fully opaque everywhere) — alpha channel in the XOR plane governs transparency.
  return buf;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData) >>> 0, 0);
  return Buffer.concat([len, typeData, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function rgbaToPng(rgba: Buffer, size: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = pngChunk("IHDR", ihdrData);

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = pngChunk("IDAT", zlib.deflateSync(raw));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

const SIZES = [16, 32, 48, 256];
const dibs: { size: number; data: Buffer; isPng: boolean }[] = SIZES.map((size) => {
  const rgba = drawPulse(size);
  if (size >= 256) return { size, data: rgbaToPng(rgba, size), isPng: true };
  return { size, data: rgbaToBmpDib(rgba, size), isPng: false };
});

const ICONDIR_SIZE = 6;
const ICONDIRENTRY_SIZE = 16;
const headerSize = ICONDIR_SIZE + ICONDIRENTRY_SIZE * dibs.length;

const header = Buffer.alloc(ICONDIR_SIZE);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(dibs.length, 4);

let offset = headerSize;
const entries: Buffer[] = [];
for (const dib of dibs) {
  const entry = Buffer.alloc(ICONDIRENTRY_SIZE);
  entry.writeUInt8(dib.size >= 256 ? 0 : dib.size, 0);
  entry.writeUInt8(dib.size >= 256 ? 0 : dib.size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(dib.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  entries.push(entry);
  offset += dib.data.length;
}

const ico = Buffer.concat([header, ...entries, ...dibs.map((d) => d.data)]);
mkdirSync(join(import.meta.dir, "..", "assets"), { recursive: true });
writeFileSync(OUT, ico);
// eslint-disable-next-line no-console
console.log(`[generate-icon] wrote ${ico.length} bytes to assets/icon.ico (sizes: ${SIZES.join(", ")})`);
