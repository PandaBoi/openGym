// Benchmark backend: runs a real GGUF through node-llama-cpp on the Mac.
//
// A `format` (see formats.js) renders runAgent()'s neutral {system, messages} into the
// model's native function-calling prompt and translates the reply back, so
// tool-calling-specialised models are scored on the format they were trained for. The
// default 'chatml' format is byte-identical to what the app ships (our JSON + GBNF).
//
// loadLlamaBackend({ modelPath, format, nCtx, maxTokens }) -> { generate, dispose, info }

import { FORMATS, formatForModel } from './formats.js'

export async function loadLlamaBackend({
  modelPath,
  format = formatForModel(modelPath),
  nCtx = 2048,
  maxTokens = 160,
} = {}) {
  if (!modelPath) throw new Error('loadLlamaBackend: modelPath is required')
  const fmt = FORMATS[format]
  if (!fmt) throw new Error(`unknown format "${format}" (have: ${Object.keys(FORMATS).join(', ')})`)

  const { getLlama, LlamaCompletion } = await import('node-llama-cpp')

  const llama = await getLlama()
  const model = await llama.loadModel({ modelPath })
  const context = await model.createContext({ contextSize: nCtx })
  const sequence = context.getSequence()
  const completion = new LlamaCompletion({ contextSequence: sequence })

  // grammar is constant per format — resolve it once from a throwaway build.
  const grammarStr = fmt.build({ system: '', messages: [] }).grammar
  const grammar = grammarStr ? await llama.createGrammar({ grammar: grammarStr }) : undefined

  // Non-GBNF formats need explicit stops or the model runs past its turn.
  const stop = grammarStr ? undefined : ['<|im_end|>', '<|im_start|>', '<|endoftext|>', '<|tool_call_end|>']

  async function generate({ system, messages }) {
    // Fresh KV per call — matches cpp/voicellm.cpp on device, and avoids the KV-shift
    // re-eval that made borderline-logit runs non-deterministic on Metal.
    try { await sequence.clearHistory() } catch { /* first call: nothing to clear */ }
    const { prompt } = fmt.build({ system, messages })
    // Tokenize with special-token parsing ON so chat markers (<|im_start|>) and
    // model-specific control tokens (<|tool_list_start|>, …) become real single tokens
    // instead of being split into text pieces the model was never trained to see.
    const tokens = model.tokenize(prompt, true)
    const raw = await completion.generateCompletion(tokens, {
      grammar, maxTokens, temperature: 0,
      ...(stop ? { customStopTriggers: stop } : {}),
    })
    return fmt.parse(raw || '')
  }

  function dispose() {
    try { completion.dispose() } catch { /* */ }
    try { context.dispose() } catch { /* */ }
    try { model.dispose() } catch { /* */ }
  }

  return {
    generate,
    dispose,
    info: { backend: 'node-llama-cpp', modelPath, format, nCtx, gpu: llama.gpu || 'unknown' },
  }
}
