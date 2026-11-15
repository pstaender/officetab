// Writer for the shared UI (src/shell/ui): its commands, menus and labels, popup menu
// controllers, its page of Tools > Options and its ribbon.
import { t } from '@shell/i18n.ts';
import type { AppRegistry, OptionsPage } from '@shell/ui/registry.ts';
import type { Controller } from '../controller.ts';
import { COMMANDS } from '../commands.ts';
import { POPUP_CONTROLLERS } from '../popupcontrollers.ts';
import { writerUi } from './labels.ts';
import { WRITER_RIBBON } from './Ribbon.tsx';

/** Tools > Options' Writing page: automatic spell checking, and how hyperlinks open. */
const WRITING_PAGE: OptionsPage<Controller> = {
  id: 'writing',
  after: 'fonts',
  label: () => t('options.writing'),
  render: (c) => <>
    <h3>{t('options.writing')}</h3>
    <label className="check"><input type="checkbox" name="autospell" defaultChecked={c.onlineSpell} /> {t('options.autospell')}</label>
    <p className="muted">{t('options.autospellHint')}</p>
    <label className="check"><input type="checkbox" name="ctrlclick" defaultChecked={c.ctrlClickHyperlink} /> {t('options.ctrlClick')}</label>
  </>,
  apply: (c, f) => {
    c.onlineSpell = f.get('autospell') === 'on';
    c.ctrlClickHyperlink = f.get('ctrlclick') === 'on';
  },
};

export const WRITER_REGISTRY: AppRegistry<Controller> = {
  commands: COMMANDS,
  ui: writerUi,
  popupControllers: POPUP_CONTROLLERS,
  optionsPages: [WRITING_PAGE],
  ribbon: WRITER_RIBBON,
};
