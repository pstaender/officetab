import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { Controller } from './controller.ts';
import { dispatch } from './commands.ts';
import './ui/app.css';

const splash = document.getElementById('splash');
const splashStatus = document.getElementById('splash-status');
if (splashStatus) splashStatus.textContent = 'Opening document…';

const controller = new Controller();
// Canvas content is invisible to the DOM, so end-to-end tests and debugging read the model here.
(globalThis as { __writer?: Controller }).__writer = controller;
(globalThis as { __dispatch?: (cmd: string) => boolean }).__dispatch = (cmd) => dispatch(controller, cmd);

// System fonts can resolve late; re-measure once they have, or text would stay laid out with fallbacks.
const fontsReady = document.fonts.ready.then(() => {
  controller.measurer.Invalidate();
  controller.sh.m_pRoot.InvalidateFonts();
  controller.sh.m_pRoot.Layout();
  controller.notify();
});

// Service workers need a secure context (HTTPS or localhost); elsewhere the app simply runs online.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Offline support unavailable:', e));
}

createRoot(document.getElementById('root')!).render(<App c={controller} />);

// The splash stays until the last document is restored and laid out with its real fonts.
void Promise.allSettled([controller.restore(), fontsReady]).then(() => {
  requestAnimationFrame(() => {
    splash?.classList.add('done');
    splash?.addEventListener('transitionend', () => splash.remove(), { once: true });
    controller.focusEditor();
  });
});
