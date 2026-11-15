// The suite's Start Center: what sfx2's BackingWindow is to LibreOffice, a page to start one of the
// apps from. Each app is a page of its own (writer/), so opening one is a navigation.
import { APPS } from '@shell/apps.ts';
import { t } from '@shell/i18n.ts';
import { suiteUrl } from '@shell/paths.ts';
// Inline, not an <img>, so the stylesheet can recolour its black for the dark theme.
import logo from './officetab26-logo.svg?raw';
import './startcenter.css';

document.title = t('startcenter.title');
const root = document.getElementById('startcenter')!;
const h1 = document.createElement('h1');
h1.className = 'logo';
h1.innerHTML = logo.replace(/^[\s\S]*?(?=<svg)/, '');
const svg = h1.querySelector('svg')!;
svg.setAttribute('role', 'img');
svg.setAttribute('aria-label', t('startcenter.title'));
svg.removeAttribute('width');
svg.removeAttribute('height');
const h2 = document.createElement('h2');
h2.textContent = t('startcenter.create');
const list = document.createElement('ul');
for (const app of APPS) {
  const a = document.createElement('a');
  a.href = `./${app.id}/`;
  a.dataset.app = app.id;
  a.style.setProperty('--app-color', app.color);
  const icon = document.createElement('img');
  icon.src = suiteUrl(`${app.id}/icon.svg`);
  icon.alt = '';
  const name = document.createElement('strong');
  name.textContent = t(`app.${app.id}`);
  const desc = document.createElement('span');
  desc.textContent = t(`app.${app.id}.description`);
  a.append(icon, name, desc);
  const li = document.createElement('li');
  li.append(a);
  list.append(li);
}
root.append(h1, h2, list);

// Service workers need a secure context (HTTPS or localhost); elsewhere the suite simply runs online.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register(suiteUrl('sw.js')).catch((e) => console.warn('Offline support unavailable:', e));
}
