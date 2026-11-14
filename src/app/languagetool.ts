// LanguageTool in this browser: requests the LanguageTool client (LanguageToolGrammarChecker)
// sends to LOCAL_LANGUAGETOOL_URL are answered by a Web Worker running the TypeScript port of
// LanguageTool (src/languagetool), in the format of LanguageTool's HTTP API. The worker starts
// on the first request and loads each language's rules and dictionaries once.
import type { FetchFn } from '@lo/lingucomponent/source/spellcheck/languagetool/languagetoolimp.ts';

/** The languages the in-browser LanguageTool has (as LanguageTool's grammar checker locales). */
export const LOCAL_LANGUAGETOOL_LOCALES = ['en', 'en-US', 'en-GB', 'en-CA', 'en-AU', 'en-NZ', 'en-ZA', 'de', 'de-DE', 'de-AT', 'de-CH'];

interface Pending { resolve: (r: { status: number; body: string }) => void }

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./languagetool.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; status: number; body: string }>) => {
    const p = pending.get(e.data.id);
    pending.delete(e.data.id);
    p?.resolve({ status: e.data.status, body: e.data.body });
  };
  worker.onerror = (e) => {
    // A worker that fails to start answers every waiting request with an error.
    for (const [id, p] of pending) { pending.delete(id); p.resolve({ status: 500, body: e.message }); }
    worker = null;
  };
  return worker;
}

/**
 * fetch() for LOCAL_LANGUAGETOOL_URL: the path (e.g. /v2/check) and the form body go to the worker,
 * with the application's absolute base URL (a worker resolves relative URLs against its script).
 * The client's abort signal (its 10 s network timeout) is ignored: there is no network to wait
 * for, and the first request of a language includes loading its rules and dictionaries, which
 * can take longer than that. The worker answers every request.
 */
export const localLanguageTool: FetchFn = (url, init) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, { resolve: (r) => resolve({ status: r.status, text: () => Promise.resolve(r.body) }) });
  getWorker().postMessage({ id, path: url.replace(/^languagetool:browser/, ''), body: init.body, base: new URL(import.meta.env.BASE_URL, location.href).href });
});
