// Calc for the shared UI (src/shell/ui): its commands, menus and labels, its pages of
// Tools > Options and its ribbon.
import type { AppRegistry } from '@shell/ui/registry.ts';
import type { Controller } from '../controller.ts';
import { COMMANDS } from '../commands.ts';
import { calcUi } from './labels.ts';
import { CALC_RIBBON } from './Ribbon.tsx';
import { CALC_OPTIONS_PAGES } from './OptionsPages.tsx';

export const CALC_REGISTRY: AppRegistry<Controller> = {
  commands: COMMANDS,
  ui: calcUi,
  optionsPages: CALC_OPTIONS_PAGES,
  ribbon: CALC_RIBBON,
};
