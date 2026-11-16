// The apps of the suite. Each is a directory of its own under src/ (src/writer/) with its own
// index.html, built to the same directory of dist/; the Start Center (src/startcenter) lists them.
// To add an app: create src/<id>/index.html, add it here, and add `app.<id>` and
// `app.<id>.description` to every catalogue in i18n.ts. vite.config.ts builds every app listed here.

export interface SuiteApp {
  /** The app's directory, under src/ and in dist/ (and its i18n keys, `app.<id>`). */
  readonly id: string;
  /** The LibreOffice module it is the shell of (src/lo/<module>). */
  readonly module: string;
  /** Its colour on the Start Center and in its icon, from the suite's logo (logo/workspace-office.svg). */
  readonly color: string;
}

export const APPS: readonly SuiteApp[] = [
  { id: 'writer', module: 'sw', color: '#0498f0' },
  { id: 'calc', module: 'sc', color: '#46c942' },
];
