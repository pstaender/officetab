import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { Controller } from './controller.ts';
import { dispatch } from './commands.ts';
import { suiteUrl } from '@shell/paths.ts';
import { APPS } from '@shell/apps.ts';
import { loadDefaultSettings } from '@shell/settings.ts';
import { setAppRegistry } from '@shell/ui/registry.ts';
import { CALC_REGISTRY } from './ui/registry.tsx';
import '@shell/ui/shell.css';
import './ui/app.css';

const splash = document.getElementById('splash');
const splashStatus = document.getElementById('splash-status');
if (splashStatus) splashStatus.textContent = 'Opening spreadsheet…';

// The shared UI (src/shell/ui) shows Calc's commands, menus and pages.
setAppRegistry(CALC_REGISTRY);

// The defaults of settings.json (settings.ts), before the controller reads the settings.
await loadDefaultSettings(suiteUrl('settings.json'), 'calc', APPS.map((a) => a.id));

const controller = new Controller();
// Canvas content is invisible to the DOM, so end-to-end tests and debugging read the model here.
(globalThis as { __calc?: Controller }).__calc = controller;
(globalThis as { __dispatch?: (cmd: string, args?: Record<string, number>) => boolean }).__dispatch = (cmd, args) => dispatch(controller, cmd, args);

const fontsReady = document.fonts.ready.then(() => controller.fontsChanged());

// Service workers need a secure context (HTTPS or localhost); elsewhere the app simply runs online.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(suiteUrl('sw.js')).catch((e) => console.warn('Offline support unavailable:', e));
}

createRoot(document.getElementById('root')!).render(<App c={controller} />);

void Promise.allSettled([controller.restore(), fontsReady]).then(() => {
  requestAnimationFrame(() => {
    splash?.classList.add('done');
    splash?.addEventListener('transitionend', () => splash.remove(), { once: true });
    controller.focusEditor();
  });
});
