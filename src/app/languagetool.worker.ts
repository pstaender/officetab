// The Web Worker running LanguageTool (src/languagetool) for this browser: answers
// /v2/check requests (form-encoded text and language) with LanguageTool's JSON.
/// <reference lib="webworker" />

self.onmessage = (e: MessageEvent<{ id: number; path: string; body: string; base: string }>) => {
  // The engine is being ported; until it is wired in, the worker answers "unavailable".
  self.postMessage({ id: e.data.id, status: 503, body: '' });
};
