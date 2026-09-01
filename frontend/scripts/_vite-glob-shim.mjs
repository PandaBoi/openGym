// Node loader hook: lets the app's frontend modules be imported outside Vite.
// i18n.js / exercises.js use Vite-only `import.meta` macros (`import.meta.glob(...)`,
// `import.meta.env`) at module scope — rewrite those on load so plain Node can run them.
//
// Usage:  node --import ./scripts/_vite-glob-shim.mjs <script.mjs>
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith('file:') && /\.(mjs|js)$/.test(url)) {
      let src
      try { src = readFileSync(fileURLToPath(url), 'utf8') } catch { src = null }
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
