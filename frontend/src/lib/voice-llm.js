// Bridges the native llama.cpp plugin to voice-llm-agent.js:
//   · a small model catalogue (downloaded on demand into app storage)
//   · Qwen ChatML prompt formatting
//   · a JSON GBNF grammar so the model can only emit {"tool":…}|{"say":…}
//   · makeGenerate() -> the generate({system, messages}) fn the agent loop calls
//
// Native only. Nothing here runs (or is imported) in the web build.

import { registerPlugin } from '@capacitor/core'

const p = registerPlugin('VoiceAssistant')

// Q4_0 (not Q4_K_M): llama.cpp repacks it at load into the i8mm/dotprod GEMM kernels,
// which run ~1.5–2x faster than Q4_K on an ARM CPU. n_ctx 2048 is plenty for the agent.
export const MODELS = {
  'qwen2.5-1.5b': {
    label: 'Fast (Qwen2.5 1.5B, ~0.9 GB)',
    file: 'qwen2.5-1.5b-instruct-q4_0.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_0.gguf?download=true',
    minBytes: 800_000_000,
    nCtx: 2048,
  },
  'qwen2.5-3b': {
    label: 'Smart (Qwen2.5 3B, ~1.8 GB)',
    file: 'qwen2.5-3b-instruct-q4_0.gguf',
    url: 'https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/resolve/main/qwen2.5-3b-instruct-q4_0.gguf?download=true',
    minBytes: 1_600_000_000,
    nCtx: 2048,
  },
}
export const DEFAULT_MODEL = 'qwen2.5-1.5b'

// GBNF: the agent's turn is exactly one JSON object of the shape we parse.
const GRAMMAR = String.raw`
root   ::= "{" ws ( tool | say ) ws "}"
tool   ::= "\"tool\"" ws ":" ws string ws "," ws "\"args\"" ws ":" ws object
say    ::= "\"say\"" ws ":" ws string
object ::= "{" ws ( member ( ws "," ws member )* )? ws "}"
member ::= string ws ":" ws value
array  ::= "[" ws ( value ( ws "," ws value )* )? ws "]"
value  ::= string | number | object | array | "true" | "false" | "null"
string ::= "\"" ( [^"\\] | "\\" ["\\/bfnrt] | "\\u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] )* "\""
number ::= "-"? ( "0" | [1-9] [0-9]* ) ( "." [0-9]+ )? ( [eE] [-+]? [0-9]+ )?
ws     ::= [ \t\n]*
`

function chatml(system, messages) {
  let s = `<|im_start|>system\n${system}<|im_end|>\n`
  for (const m of messages) {
    if (m.role === 'assistant') s += `<|im_start|>assistant\n${m.content}<|im_end|>\n`
    else if (m.role === 'tool') s += `<|im_start|>user\n[tool_result ${m.name || ''}] ${m.content}<|im_end|>\n`
    else s += `<|im_start|>user\n${m.content}<|im_end|>\n`
  }
  return s + '<|im_start|>assistant\n'
}

export const voiceLlm = {
  async available() {
    try { return (await p.llmAvailable()).available === true } catch { return false }
  },
  async isLoaded() {
    try { return (await p.modelLoaded()).loaded === true } catch { return false }
  },
  async modelState(key = DEFAULT_MODEL) {
    const m = MODELS[key]
    try { return { ...(await p.modelInfo({ name: m.file })), key, label: m.label } }
    catch { return { exists: false, key, label: m.label } }
  },
  // onProgress({ received, total, pct })
  async download(key = DEFAULT_MODEL, onProgress) {
    const m = MODELS[key]
    let sub
    if (onProgress) sub = await p.addListener('modelProgress', e => { if (e.name === m.file) onProgress(e) })
    try { return await p.downloadModel({ url: m.url, name: m.file, minBytes: m.minBytes }) }
    finally { sub?.remove?.() }
  },
  async cancelDownload() { try { await p.cancelDownload() } catch {} },
  async deleteModel(key = DEFAULT_MODEL) { try { await p.deleteModel({ name: MODELS[key].file }) } catch {} },

  async load(key = DEFAULT_MODEL) {
    const m = MODELS[key]
    const info = await p.modelInfo({ name: m.file })
    if (!info.exists) throw new Error('model not downloaded')
    return p.loadModel({ path: info.path, nCtx: m.nCtx })
  },
  async unload() { try { await p.unloadModel() } catch {} },

  // the function voice-llm-agent.runAgent() calls each turn
  makeGenerate() {
    return async ({ system, messages }) => {
      const r = await p.generate({ prompt: chatml(system, messages), grammar: GRAMMAR, maxTokens: 128, temp: 0 })
      return r?.text || ''
    }
  },
}
