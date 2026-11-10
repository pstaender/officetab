import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { Controller } from './controller.ts';
import './ui/app.css';

const controller = new Controller();
// Canvas content is invisible to the DOM, so end-to-end tests and debugging read the model here.
(globalThis as { __writer?: Controller }).__writer = controller;
void controller.restore();

// System fonts can resolve late; re-measure once they have, or text would stay laid out with fallbacks.
void document.fonts.ready.then(() => {
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
