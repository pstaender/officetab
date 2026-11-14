// ZipFile: reading a package, and recovering a broken one from its local headers (ZipFile::recover).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrokenPackageError, readZip, writeZip } from '../../src/lo/package/source/zipapi/zip.ts';
import { ImportDOCX } from '../../src/lo/sw/source/writerfilter/dmapper/DomainMapper.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined);
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

async function pkg(): Promise<Uint8Array> {
  return writeZip([
    { name: 'mimetype', data: enc('application/vnd.oasis.opendocument.text'), store: true },
    { name: 'content.xml', data: enc('<content>'.repeat(100)) },
    { name: 'dir/', data: new Uint8Array(0), store: true },
    { name: 'dir/a.txt', data: enc('hello') },
  ]);
}

describe('readZip', () => {
  it('reads a package by its central directory', async () => {
    const files = await readZip(await pkg());
    expect(dec(files.get('dir/a.txt'))).toBe('hello');
  });

  it('a package followed by more than 64 KiB of other data is broken, and is repaired', async () => {
    const bytes = concat(await pkg(), new Uint8Array(100_000));
    await expect(readZip(bytes)).rejects.toBeInstanceOf(BrokenPackageError);
    const files = await readZip(bytes, true);
    expect(dec(files.get('mimetype'))).toBe('application/vnd.oasis.opendocument.text');
    expect(dec(files.get('content.xml'))).toBe('<content>'.repeat(100));
    expect(dec(files.get('dir/a.txt'))).toBe('hello');
    // The directory's entry is dropped once a file in it is found.
    expect(files.has('dir')).toBe(false);
  });

  it('a package cut off in its central directory is repaired', async () => {
    const whole = await pkg();
    const files = await readZip(whole.subarray(0, whole.length - 40), true);
    expect(dec(files.get('dir/a.txt'))).toBe('hello');
  });

  it('a stream whose data does not match its size and checksum is recovered empty', async () => {
    const bytes = concat(await pkg(), new Uint8Array(70_000));
    const at = new TextDecoder('latin1').decode(bytes).indexOf('content.xml') + 'content.xml'.length;
    bytes[at + 2] = bytes[at + 2]! ^ 0xff;
    const files = await readZip(bytes, true);
    expect(files.get('content.xml')).toHaveLength(0);
    expect(dec(files.get('dir/a.txt'))).toBe('hello');
  });

  it('nothing to recover stays broken', async () => {
    await expect(readZip(new Uint8Array(1000), true)).rejects.toBeInstanceOf(BrokenPackageError);
    await expect(readZip(enc('not a zip'))).rejects.toBeInstanceOf(BrokenPackageError);
  });

  it('a Word document padded with zeros opens once repaired', async () => {
    const docx = new Uint8Array(readFileSync(join(import.meta.dirname, '../../specs/writer/exam.docx')));
    const padded = concat(docx, new Uint8Array(200_000));
    await expect(ImportDOCX(padded)).rejects.toBeInstanceOf(BrokenPackageError);
    const repaired = await ImportDOCX(padded, true);
    const original = await ImportDOCX(docx);
    expect([...repaired.doc.allText()].map((n) => n.m_Text)).toEqual([...original.doc.allText()].map((n) => n.m_Text));
  });
});
