// Writes the PWA icons: a blue rounded square with a white page and text lines. Run once; output is committed.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { resolve } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const t = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(t));
  return Buffer.concat([len, t, sum]);
};

function icon(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const u = (v: number) => v * size;
  const r = u(0.18);
  const inRounded = (x: number, y: number) => {
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inBox = (x: number, y: number, a: number, b: number, c: number, d: number) => x >= u(a) && x < u(c) && y >= u(b) && y < u(d);
  for (let y = 0; y < size; y++) {
    let o = y * (size * 4 + 1) + 1;
    for (let x = 0; x < size; x++) {
      let p = [0, 0, 0, 0];
      if (inRounded(x + 0.5, y + 0.5)) {
        p = [31, 111, 235, 255];
        if (inBox(x, y, 0.27, 0.18, 0.73, 0.82)) p = [255, 255, 255, 255];
        for (const [t, w] of [[0.3, 0.64], [0.41, 0.64], [0.52, 0.64], [0.63, 0.5]] as const) if (inBox(x, y, 0.36, t, w, t + 0.05)) p = [31, 111, 235, 255];
      }
      raw.set(p, o); o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [192, 512]) writeFileSync(resolve(import.meta.dirname, `../../public/icon-${s}.png`), icon(s));
