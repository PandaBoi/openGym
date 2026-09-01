// Node loader so the voice benchmark's worker.mjs can import the app's real modules
// (store, tools, agent loop) outside Vite.
//
//   node --import ./scripts/voice-eval/_node-loader.mjs scripts/voice-eval/worker.mjs …
//
//  · rewrites Vite-only `import.meta.glob(...)` / `import.meta.env` (i18n.js, exercises.js)
//  · stubs `src/sheets.jsx` — the only .jsx in the tools import graph; the benchmark never
//    finishes a real workout, it just needs `finishWorkout` to exist.
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && url.endsWith('/src/sheets.jsx')) {
      return { format: 'module', shortCircuit: true, source: 'export const finishWorkout = () => {}\n' }
    }
    if (url.startsWith('file:') && /\.(mjs|js)$/.test(url)) {
      let src = null
      try { src = readFileSync(fileURLToPath(url), 'utf8') } catch { /* fall through */ }
      if (src && (src.includes('import.meta.glob') || src.includes('import.meta.env'))) {
        return {
          format: 'module',
          shortCircuit: true,
          source: src
            .replace(/import\.meta\.glob\([^)]*\)/g, '({})')
            .replace(/import\.meta\.env/g, '({})'),
        }
      }
    }
    return nextLoad(url, context)
  },
})
