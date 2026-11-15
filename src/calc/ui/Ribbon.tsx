// Calc's part of the ribbon (Menu > Ribbon): its shells' context and the controls it draws
// itself; the ribbon is the shell's (src/shell/ui/Ribbon.tsx).
import type { RibbonConfig } from '@shell/ui/registry.ts';
import { t } from '@shell/i18n.ts';
import type { Controller } from '../controller.ts';
import { TOOL_CONTROLS, toolControl } from './Bars.tsx';

/** ScCellShell's context (vcl::EnumContext::Context::Cell); EditCell while a cell is edited. */
const shellContext = (c: Controller): string => (c.edit ? 'EditCell' : 'Cell');

/** Calc's ribbon: its context, its own controls (font boxes, colours, borders, cell styles), and New's entry. */
export const CALC_RIBBON: RibbonConfig<Controller> = {
  context: shellContext,
  special: new Set([...TOOL_CONTROLS, ...['Default', 'Heading 1', 'Heading 2', 'Good', 'Neutral', 'Bad', 'Accent', 'Note'].map((s) => `.uno:StyleApply?Style:string=${s}&FamilyName:string=CellStyles`)]),
  control: (c, cmd) => toolControl(c, cmd),
  newBefore: '.uno:OpenFromCalc',
  newEntries: () => [{ cmd: '.uno:AddDirect', label: t('ribbon.newSpreadsheet') }],
};

export { Ribbon } from '@shell/ui/Ribbon.tsx';
