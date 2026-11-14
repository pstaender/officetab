// Writer's font colour and character highlighting controls: the shell's ColorControl with the
// colour at the cursor and the colours the document uses.
import type { Controller } from '../controller.ts';
import { documentColors, type ColorKind } from '../colors.ts';
import { ColorControl as ShellColorControl } from '@shell/ui/ColorWindow.tsx';

export function ColorControl({ c, kind }: { c: Controller; kind: ColorKind }) {
  const value: string | null = kind === 'font' ? c.sh.GetAttr('RES_CHRATR_COLOR') : c.sh.GetAttr('RES_CHRATR_BACKGROUND');
  return <ShellColorControl c={c} kind={kind} value={value} used={() => documentColors(c.sh.m_pDoc)} />;
}
