// Generate the PWA icon PNGs (manifest 192/512 + apple-touch 180) with no
// image dependencies: a minimal PNG encoder (node:zlib deflate + CRC-32)
// over pixels from a supersampled point-in-shape test. The icon is a white
// map pin on the app's indigo route colour.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BG = [0x63, 0x66, 0xf1]; // indigo — matches the route colour in the map view

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(size, rgb) {
  // One filter byte (0 = None) per scanline ahead of the raw RGB bytes.
  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Point-in-pin test in unit space (0..1): circle head + tapered tail,
// minus a round hole. The hole is tested first so the tail never fills it.
function inPin(x, y) {
  const dx = x - 0.5, dy = y - 0.42;
  const d2 = dx * dx + dy * dy;
  if (d2 <= 0.088 * 0.088) return false; // hole
  if (d2 <= 0.21 * 0.21) return true; // head
  if (y > 0.42 && y <= 0.78) {
    const half = 0.16 * (0.78 - y) / 0.36; // tapers to the tip
    return Math.abs(dx) <= half;
  }
  return false;
}

export function drawIcon(size) {
  const px = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0; // 2×2 supersampling for soft edges
      for (const oy of [0.25, 0.75]) {
        for (const ox of [0.25, 0.75]) {
          if (inPin((x + ox) / size, (y + oy) / size)) cov++;
        }
      }
      const a = cov / 4;
      const i = (y * size + x) * 3;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] + (255 - BG[c]) * a);
    }
  }
  return px;
}

export function writeIcons(dir) {
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
  ]) {
    writeFileSync(join(dir, name), encodePng(size, drawIcon(size)));
  }
}
