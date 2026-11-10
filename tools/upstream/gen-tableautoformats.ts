// Generates src/app/generated/tableautoformats.json: the table AutoFormat styles of LibreOffice's
// extras/source/misc_config/autotbl.fmt, read with the port of SwTableAutoFormatTable::Load.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LoadTableAutoFormats } from '../../src/lo/sw/source/core/doc/tblafmt.ts';
import { POOL_DEFAULTS } from '../../src/lo/sw/inc/hintids.ts';

const ROOT = join(import.meta.dirname, '../..');
const data = new Uint8Array(readFileSync(join(ROOT, 'upstream/core/extras/source/misc_config/autotbl.fmt')));
const formats = LoadTableAutoFormats(data, POOL_DEFAULTS.RES_CHRATR_FONT);
writeFileSync(join(ROOT, 'src/app/generated/tableautoformats.json'), `${JSON.stringify(formats)}\n`);
console.log(`${formats.length} table AutoFormat styles`);
