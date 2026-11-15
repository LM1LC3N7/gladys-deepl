// Generates cover.png (800x534) for gladys-deepl: plain Node, no dependency.
// Two speech bubbles of text lines joined by an arrow: a text and its
// translation, on a gradient (no brand logo).
// Usage: node scripts/cover.mjs cover.png
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 800;
const H = 534;
const px = Buffer.alloc(W * H * 3);
const set = (x, y, [r, g, b], a = 1) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = px[i] * (1 - a) + r * a;
  px[i + 1] = px[i + 1] * (1 - a) + g * a;
  px[i + 2] = px[i + 2] * (1 - a) + b * a;
};
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const t = (x / W) * 0.6 + (y / H) * 0.4;
    set(x, y, [20 + 30 * t, 40 + 50 * t, 80 + 60 * t]);
  }
}
/** A rounded rectangle, anti-aliased on its corners. */
const box = (x0, y0, w, h, r, color, alpha = 1) => {
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const cx = Math.min(Math.max(x + 0.5, x0 + r), x0 + w - r);
      const cy = Math.min(Math.max(y + 0.5, y0 + r), y0 + h - r);
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const a = Math.max(0, Math.min(1, r - d + 0.5));
      if (a > 0) set(x, y, color, a * alpha);
    }
  }
};
const tail = (x0, y0, size, color, left) => {
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= i; j += 1) set(left ? x0 - j : x0 + j, y0 + i, color);
  }
};
const white = [255, 255, 255];
const grey = [175, 186, 204];
const accent = [90, 170, 250];
const deep = [16, 32, 64];
// The source bubble (white, grey lines) on the left.
box(96, 126, 250, 200, 24, [0, 0, 0], 0.25);
box(90, 118, 250, 200, 24, white);
tail(116, 316, 26, white, true);
for (const [y, w] of [
  [156, 190],
  [190, 160],
  [224, 180],
  [258, 110],
])
  box(120, y, w, 14, 7, grey);
// The translated bubble (accent, dark lines) on the right.
box(466, 222, 250, 200, 24, [0, 0, 0], 0.25);
box(460, 214, 250, 200, 24, accent);
tail(684, 412, 26, accent, false);
for (const [y, w] of [
  [252, 180],
  [286, 196],
  [320, 140],
  [354, 170],
])
  box(490, y, w, 14, 7, deep);
// The arrow between them.
box(360, 262, 70, 14, 7, white);
for (let i = 0; i < 26; i += 1) {
  for (let j = -i; j <= i; j += 1) set(452 - i, 269 + j, white);
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 3 + 1)] = 0;
  px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(process.argv[2] ?? 'cover.png', png);
console.log('cover', png.length, 'bytes');
