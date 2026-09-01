// Minimal DOM globals so store modules can be imported under the plain `node` vitest
// environment (the repo has no jsdom dependency). Import this FIRST in a test file.
globalThis.localStorage ??= (() => {
  const m = new Map()
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  }
})()
globalThis.document ??= {
  addEventListener() {}, removeEventListener() {}, querySelector: () => null,
  documentElement: { dataset: {}, style: {}, lang: '' }, visibilityState: 'visible',
}
globalThis.navigator ??= { language: 'en-US' }
if (!globalThis.navigator.vibrate) globalThis.navigator.vibrate = () => {}
