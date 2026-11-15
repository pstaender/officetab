// Writes the PWA icons: a rounded square with a white page, for Writer (blue, text lines) in public/writer/ and
// Calc (green, a grid of cells) in public/calc/. Run once; output is committed.
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

type Rgba = readonly [number, number, number, number];
type Box = readonly [number, number, number, number];

function icon(size: number, colour: Rgba, marks: readonly Box[]): Buffer {
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
        p = [...colour];
        if (inBox(x, y, 0.27, 0.18, 0.73, 0.82)) p = [255, 255, 255, 255];
        for (const [a, b, c, d] of marks) if (inBox(x, y, a, b, c, d)) p = [...colour];
      }
      raw.set(p, o); o += 4;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Writer: four text lines, the last one shorter.
const writer: Box[] = [[0.3, 0.64], [0.41, 0.64], [0.52, 0.64], [0.63, 0.5]].map(([t, w]) => [0.36, t!, w!, t! + 0.05] as const);
// Calc: three columns of five cells.
const calc: Box[] = [];
for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
  const x = 0.34 + col * 0.115, y = 0.28 + row * 0.095;
  calc.push([x, y, x + 0.09, y + 0.06]);
}

const out = (path: string) => resolve(import.meta.dirname, '../../public', path);
for (const s of [192, 512]) {
  writeFileSync(out(`writer/icon-${s}.png`), icon(s, [31, 111, 235, 255], writer));
  writeFileSync(out(`calc/icon-${s}.png`), icon(s, [60, 188, 69, 255], calc));
}
