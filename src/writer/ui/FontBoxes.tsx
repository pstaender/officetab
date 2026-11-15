// Writer's font name and font size boxes of the formatting bar: the shell's, setting the
// selection's font and size.
import type { Controller } from '../controller.ts';
import { FontNameBox as ShellFontNameBox, FontSizeBox as ShellFontSizeBox } from '@shell/ui/FontBoxes.tsx';

export { FONT_SIZES, FontNameField, FontSizeCombo, opensList } from '@shell/ui/FontBoxes.tsx';

export function FontNameBox({ c, font, families }: { c: Controller; font: string; families: string[] }) {
  return <ShellFontNameBox c={c} font={font} families={families} onApply={(name) => c.sh.SetCharAttr({ RES_CHRATR_FONT: name })} />;
}

export function FontSizeBox({ c, size }: { c: Controller; size: number }) {
  return <ShellFontSizeBox c={c} size={size} onApply={(pt) => c.sh.SetCharAttr({ RES_CHRATR_FONTSIZE: Math.round(pt * 20) })} />;
}
