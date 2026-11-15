import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { Controller } from './controller.ts';
import { dispatch } from './commands.ts';
import { suiteUrl } from '@shell/paths.ts';
import { APPS } from '@shell/apps.ts';
import { loadDefaultSettings } from '@shell/settings.ts';
import { setAppRegistry } from '@shell/ui/registry.ts';
import { WRITER_REGISTRY } from './ui/registry.tsx';
import '@shell/ui/shell.css';
import './ui/app.css';

const splash = document.getElementById('splash');
const splashStatus = document.getElementById('splash-status');
if (splashStatus) splashStatus.textContent = 'Opening document…';

// The shared UI (src/shell/ui) shows Writer's commands, menus and pages.
setAppRegistry(WRITER_REGISTRY);

// The defaults of settings.json (settings.ts), before the controller reads the settings.
await loadDefaultSettings(suiteUrl('settings.json'), 'writer', APPS.map((a) => a.id));

const controller = new Controller();
// Canvas content is invisible to the DOM, so end-to-end tests and debugging read the model here.
(globalThis as { __writer?: Controller }).__writer = controller;
(globalThis as { __dispatch?: (cmd: string) => boolean }).__dispatch = (cmd) => dispatch(controller, cmd);

// Fonts can resolve late; re-measure once they have (if any did), or text would stay laid out with fallbacks.
const fontsReady = document.fonts.ready.then(() => controller.fontsChanged());

// Service workers need a secure context (HTTPS or localhost); elsewhere the app simply runs online.
// One worker at the suite's root serves every app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(suiteUrl('sw.js')).catch((e) => console.warn('Offline support unavailable:', e));
}

createRoot(document.getElementById('root')!).render(<App c={controller} />);

// The splash stays until the last document is restored and laid out with its real fonts.
void Promise.allSettled([controller.restore(), fontsReady]).then(() => {
  requestAnimationFrame(() => {
    splash?.classList.add('done');
    splash?.addEventListener('transitionend', () => splash.remove(), { once: true });
    controller.focusEditor();
    // ?test-toast: Save's version toast, staying (its ring runs for an hour) to work on its look.
    if (new URLSearchParams(location.search).has('test-toast')) controller.versionSavedNotice(3_600_000);
  });
});
