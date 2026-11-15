// The status bar's selection functions (ScTabViewShell::GetFunction) with their labels.
import { t } from '@shell/i18n.ts';
import { GetFunction, STATUS_FUNCS } from '@lo/sc/source/ui/view/tabvwsha.ts';
import type { Controller } from './controller.ts';

export { STATUS_FUNCS };

export function GetStatusFunctionValues(c: Controller): { label: string; value: string }[] {
  return GetFunction(c.view.GetViewData(), c.appOptions.GetStatusFunc()).map((f) => ({ label: t(`calc.func.${f.key}`), value: f.value }));
}
