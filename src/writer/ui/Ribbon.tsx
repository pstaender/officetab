// Writer's part of the ribbon (Menu > Ribbon): its shells' context and the controls it draws
// itself; the ribbon is the shell's (src/shell/ui/Ribbon.tsx).
import type { ReactNode } from 'react';
import type { Controller } from '../controller.ts';
import { OPTIMIZE_TABLE, dispatch } from '../commands.ts';
import { t } from '@shell/i18n.ts';
import type { RibbonConfig } from '@shell/ui/registry.ts';
import {
  AnchorBox, BORDER_PRESETS, FontColorPick, GrafSpin, HighlightPick, LINE_WIDTHS, ParaStyleBox, ToolButton, ToolColor, ToolPopup,
  twipsToPt,
} from './Bars.tsx';
import { FontNameBox, FontSizeBox } from './FontBoxes.tsx';
import { menuLabel, tooltip } from './labels.ts';

/**
 * The context of the topmost shell, as sfx2's ContextChangeEventMultiplexer reports it to the
 * notebookbar (vcl::EnumContext): a selected draw object, OLE object, graphic or frame, a shape's
 * text being edited, a table, else text.
 */
function shellContext(c: Controller): string {
  const sh = c.sh;
  if (sh.IsFrameSelected()) {
    const fmt = sh.GetFlyFrameFormat();
    return fmt?.m_pShape ? 'Draw' : fmt?.m_pMath ? 'OLE' : fmt?.graphic !== undefined ? 'Graphic' : 'Frame';
  }
  const cur = sh.GetCurrFlyName();
  if (cur && sh.GetFlyFrameFormat(cur)?.m_pShape) return 'DrawText';
  return sh.IsCursorInTable() ? 'Table' : 'Text';
}

/** The commands of a tab that work, with the controls the shell draws itself. */
const SPECIAL = new Set([
  '.uno:CharFontName', '.uno:FontHeight', '.uno:StylesPreview', '.uno:Color', '.uno:CharBackColor', '.uno:AnchorMenu',
  '.uno:TableCellBackgroundColor', '.uno:FrameLineColor', '.uno:SetBorderStyle', '.uno:LineStyle', '.uno:OptimizeTable',
  '.uno:GrafMode', '.uno:GrafTransparence', '.uno:GrafLuminance', '.uno:GrafContrast', '.uno:GrafGamma',
]);

function Control({ c, cmd, labeled }: { c: Controller; cmd: string; labeled: boolean }): ReactNode | undefined {
  const sh = c.sh;
  const a = () => sh.GetGrfAttr();
  switch (cmd) {
    case '.uno:CharFontName': {
      const font = sh.GetAttr('RES_CHRATR_FONT');
      return <FontNameBox c={c} font={font} families={c.fonts.listFonts([font, ...c.documentFonts()])} />;
    }
    case '.uno:FontHeight': return <FontSizeBox c={c} size={twipsToPt(sh.GetAttr('RES_CHRATR_FONTSIZE'))} />;
    // The web shell's addition: Clear Direct Formatting beside the styles, which it undoes the effect of.
    case '.uno:StylesPreview': return <><ParaStyleBox c={c} /><ToolButton c={c} cmd=".uno:ResetAttributes" /></>;
    case '.uno:Color': return <FontColorPick c={c} />;
    case '.uno:CharBackColor': return <HighlightPick c={c} />;
    case '.uno:AnchorMenu': return sh.IsFrameSelected() ? <AnchorBox c={c} /> : null;
    case '.uno:TableCellBackgroundColor': return <ToolColor c={c} cmd={cmd} value={sh.GetBoxBackground() ?? '#ffffff'} />;
    case '.uno:FrameLineColor': return <ToolColor c={c} cmd={cmd} value="#000000" />;
    case '.uno:SetBorderStyle': return <ToolPopup c={c} cmd={cmd} options={BORDER_PRESETS} />;
    case '.uno:LineStyle': return <ToolPopup c={c} cmd={cmd} options={LINE_WIDTHS} />;
    case '.uno:OptimizeTable': return <ToolPopup c={c} cmd={cmd} options={OPTIMIZE_TABLE.map((k, i) => [i, menuLabel(k)])} />;
    case '.uno:GrafMode':
      return (
        <select aria-label={tooltip(cmd)} title={tooltip(cmd)} value={a().m_eDrawMode ?? 0} onChange={(e) => { dispatch(c, cmd, { GrafMode: Number(e.target.value) }); c.focusEditor(); }}>
          {(['standard', 'greys', 'mono', 'watermark'] as const).map((m, i) => <option key={m} value={i}>{t(`grafmode.${m}`)}</option>)}
        </select>
      );
    case '.uno:GrafTransparence': return <GrafSpin c={c} cmd={cmd} value={a().m_nTransparency ?? 0} min={0} max={100} />;
    case '.uno:GrafLuminance': return <GrafSpin c={c} cmd={cmd} value={a().m_nLuminance ?? 0} min={-100} max={100} />;
    case '.uno:GrafContrast': return <GrafSpin c={c} cmd={cmd} value={a().m_nContrast ?? 0} min={-100} max={100} />;
    case '.uno:GrafGamma': return <GrafSpin c={c} cmd={cmd} value={a().m_fGamma ?? 1} min={0.1} max={10} step={0.01} unit="" />;
    case '.uno:ColorSettings':
      // The colorbar's red, green and blue fields while it is on.
      return <>
        <ToolButton c={c} cmd={cmd} labeled={labeled} />
        {c.showColorBar && <>
          <GrafSpin c={c} cmd=".uno:GrafRed" value={a().m_nChannelR ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafGreen" value={a().m_nChannelG ?? 0} min={-100} max={100} />
          <GrafSpin c={c} cmd=".uno:GrafBlue" value={a().m_nChannelB ?? 0} min={-100} max={100} />
        </>}
      </>;
    default: return undefined;
  }
}

/** Writer's ribbon: its context, its own controls, and New's entries (a document or a template). */
export const WRITER_RIBBON: RibbonConfig<Controller> = {
  context: shellContext,
  special: SPECIAL,
  control: (c, cmd, labeled) => Control({ c, cmd, labeled }),
  newBefore: '.uno:OpenFromWriter',
  newEntries: () => [{ cmd: '.uno:AddDirect', label: t('ribbon.newDocument') }, { cmd: 'app:NewTemplate', label: t('ribbon.newTemplate') }],
};

export { Ribbon } from '@shell/ui/Ribbon.tsx';


