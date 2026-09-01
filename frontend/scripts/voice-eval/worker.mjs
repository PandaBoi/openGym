// JS execution bridge for the voice benchmark. Python (run.py) drives this; it owns the
// bits that must stay in JS — the real agent loop, the workout tools, the Zustand store,
// the GGUF via node-llama-cpp — and emits raw per-case traces. Grading lives in grade.py.
//
//   node --import ./scripts/voice-eval/_node-loader.mjs scripts/voice-eval/worker.mjs \
//        --model-path <gguf> --format <chatml|hammer|lfm2-tool> [--n-ctx 2048] \
//        [--cases scripts/voice-eval/cases.json] [--only <substr>] [--out <file>]
//
// Writes a traces JSON ({ model, backend, ran_at, cases: [...] }) to --out or stdout.

import '../../src/lib/test-dom-shim.js'
import { readFileSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { useStore } from '../../src/store/useStore.js'
import { runAgent } from '../../src/lib/voice-llm-agent.js'
import { baseState, idleState } from './fixtures.js'
import { loadLlamaBackend } from './backend-llama.js'

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const MODEL_PATH = arg('model-path')
const FORMAT = arg('format', 'chatml')
const N_CTX = Number(arg('n-ctx', '2048'))
const CASES_FILE = arg('cases', new URL('./cases.json', import.meta.url).pathname)
const ONLY = arg('only')
const OUT = arg('out')

if (!MODEL_PATH) { console.error('worker: --model-path is required'); process.exit(2) }

const { cases } = JSON.parse(readFileSync(CASES_FILE, 'utf8'))
const selected = ONLY ? cases.filter(c => c.id.includes(ONLY)) : cases
if (!selected.length) { console.error(`worker: no cases match --only ${ONLY}`); process.exit(2) }

function seed(which) {
  const s = which === 'idle' ? idleState() : baseState()
  useStore.getState().replaceState({ ...JSON.parse(JSON.stringify(useStore.getState().S)), ...s })
}

const backend = await loadLlamaBackend({ modelPath: MODEL_PATH, format: FORMAT, nCtx: N_CTX })

const out = {
  model: { path: MODEL_PATH, format: FORMAT, n_ctx: N_CTX },
  backend: backend.info,
  ran_at: new Date().toISOString(),
  node: process.version,
  cases: [],
}

for (const c of selected) {
  seed(c.state)
  const t0 = performance.now()
  let r
  try {
    r = await runAgent(c.transcript, backend.generate)
  } catch (e) {
    r = { speak: '', steps: [], error: String((e && e.message) || e) }
  }
  const toolSteps = (r.steps || []).filter(s => s.tool)
  out.cases.push({
    id: c.id,
    transcript: c.transcript,
    state: c.state || 'base',
    tools: toolSteps.map(s => s.tool),
    calls: toolSteps.map(s => ({ tool: s.tool, args: s.args || {} })),
    speak: r.speak || '',
    exhausted: !!r.exhausted,
    forced_say: !!r.forcedSay,
    error: r.error || null,
    ms: Math.round(performance.now() - t0),
  })
  process.stderr.write('.')
}
process.stderr.write('\n')

backend.dispose?.()

const json = JSON.stringify(out, null, 2)
if (OUT) { writeFileSync(OUT, json); console.error(`worker: ${out.cases.length} traces -> ${OUT}`) }
else process.stdout.write(json)
process.exit(0)
