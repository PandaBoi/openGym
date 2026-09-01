// Bridges the native llama.cpp plugin to voice-llm-agent.js:
//   · a small model catalogue (downloaded on demand into app storage)
//   · per-model prompt/parse adapters (voice-llm-formats.js) — Qwen JSON+GBNF, or
//     Hammer's list format with no grammar
//   · makeGenerate() -> the generate({system, messages}) fn the agent loop calls
//
// Native only. Nothing here runs (or is imported) in the web build.

import { registerPlugin } from '@capacitor/core'
import { FORMATS } from './voice-llm-formats.js'

export { GRAMMAR, chatml } from './voice-llm-format.js'

const p = registerPlugin('VoiceAssistant')

let loadedKey = null   // which MODELS key is currently in memory (set by load/unload)

// Q4_0 (not Q4_K_M): llama.cpp repacks it at load into the i8mm/dotprod GEMM kernels,
// which run ~1.5–2x faster than Q4_K on an ARM CPU. n_ctx 2048 is plenty for the agent.
// `format` selects a prompt/parse adapter in voice-llm-formats.js. Q4_0 (not Q4_K_M):
// llama.cpp repacks it at load into the i8mm/dotprod GEMM kernels on ARM.
export const MODELS = {
  'hammer2.1-1.5b': {
    label: 'Standard (Hammer 2.1 1.5B, ~0.9 GB)',
    short: 'Standard',
    file: 'hammer2.1-1.5b-q4_0.gguf',
    url: 'https://huggingface.co/Melvin56/Hammer2.1-1.5b-GGUF/resolve/main/hammer2.1-1.5b-Q4_0.gguf?download=true',
    minBytes: 800_000_000,
    nCtx: 2048,
    format: 'hammer',
  },
  'qwen2.5-3b': {
    label: 'Alt (Qwen2.5 3B, ~1.8 GB)',
    short: 'Qwen 3B',
    file: 'qwen2.5-3b-instruct-q4_0.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_0.gguf?download=true',
    minBytes: 1_600_000_000,
    nCtx: 2048,
    format: 'chatml',
  },
}
export const DEFAULT_MODEL = 'hammer2.1-1.5b'
// tolerate a stale localStorage key pointing at a model we no longer ship
const M = key => MODELS[key] || MODELS[DEFAULT_MODEL]
const fmtFor = key => FORMATS[M(key).format || 'chatml']

export const voiceLlm = {
  async available() {
    try { return (await p.llmAvailable()).available === true } catch { return false }
  },
  async isLoaded() {
    try { return (await p.modelLoaded()).loaded === true } catch { return false }
  },
  async modelState(key = DEFAULT_MODEL) {
    const m = M(key)
    try { return { ...(await p.modelInfo({ name: m.file })), key, label: m.label } }
    catch { return { exists: false, key, label: m.label } }
  },
  // onProgress({ received, total, pct })
  async download(key = DEFAULT_MODEL, onProgress) {
    const m = M(key)
    let sub
    if (onProgress) sub = await p.addListener('modelProgress', e => { if (e.name === m.file) onProgress(e) })
    try { return await p.downloadModel({ url: m.url, name: m.file, minBytes: m.minBytes }) }
    finally { sub?.remove?.() }
  },
  async cancelDownload() { try { await p.cancelDownload() } catch {} },
  async deleteModel(key = DEFAULT_MODEL) { try { await p.deleteModel({ name: M(key).file }) } catch {} },

  async load(key = DEFAULT_MODEL) {
    const m = M(key)
    const info = await p.modelInfo({ name: m.file })
    if (!info.exists) throw new Error('model not downloaded')
    loadedKey = MODELS[key] ? key : DEFAULT_MODEL
    return p.loadModel({ path: info.path, nCtx: m.nCtx })
  },
  async unload() { loadedKey = null; try { await p.unloadModel() } catch {} },

  // Run one 1-token pass over the static prompt prefix (system block + tool list, ~300
  // tokens) so it lands in the KV cache. voicellm.cpp reuses the shared leading tokens
  // between calls, so the first real command then skips that prompt-eval. Best-effort.
  async warm(key = loadedKey || DEFAULT_MODEL) {
    const fmt = fmtFor(key)
    let system = ''
    try { system = (await import('./voice-llm-agent.js')).buildSystemPrompt() } catch { /* chatml-only; hammer ignores it */ }
    const { prompt, grammar } = fmt.build({ system, messages: [{ role: 'user', content: 'ready' }] })
    try { await p.generate({ prompt, grammar: grammar || '', maxTokens: 1, temp: 0 }) } catch { /* warm-up is optional */ }
  },

  // the function voice-llm-agent.runAgent() calls each turn. Uses the adapter for the
  // currently-loaded model: builds its native prompt, generates (GBNF-constrained only
  // for the chatml format), and parses the reply back to {"tool"|"say"} for runAgent.
  makeGenerate(key = loadedKey || DEFAULT_MODEL) {
    const fmt = fmtFor(key)
    return async ({ system, messages }) => {
      const { prompt, grammar } = fmt.build({ system, messages })
      const r = await p.generate({ prompt, grammar: grammar || '', maxTokens: 160, temp: 0 })
      return fmt.parse(r?.text || '')
    }
  },
}
