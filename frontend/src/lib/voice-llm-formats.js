// Per-model prompt / output adapters for the on-device agent.
//
// runAgent() (voice-llm-agent.js) speaks one neutral shape: it calls
// generate({system, messages}) and reads back a string that extractJson() turns into
// {"tool":NAME,"args":{…}} or {"say":"…"}. An adapter renders that neutral conversation
// into a given model's native function-calling format and translates the reply back — so
// a model fine-tuned for tool calling (Hammer) runs in the format it was trained for.
//
//   FORMATS[key] = {
//     build({system, messages}) -> { prompt, grammar }   // grammar '' = unconstrained
//     parse(raw) -> string                               // a string extractJson() reads
//   }
//
// The SAME module backs the benchmark (scripts/voice-eval/formats.js re-exports this), so
// a score there reflects exactly what ships.

import { TOOLS } from './voice-tools.js'
import { GRAMMAR, chatml } from './voice-llm-format.js'

// name/description/parameters only — the runnable `run` fn is dropped.
const TOOL_DEFS = TOOLS.map(({ name, description, parameters }) => ({ name, description, parameters }))

/* ===================== chatml — our {"tool"|"say"} JSON + GBNF ===================== *
 * Qwen2.5 / Qwen3 / any ChatML instruct model. Byte-identical to the original path.   */
export const chatmlFormat = {
  build: ({ system, messages }) => ({ prompt: chatml(system, messages), grammar: GRAMMAR }),
  parse: raw => raw,
}

/* ============================== hammer — Hammer 2.1 =============================== *
 * Qwen2.5-Coder base. Its chat template wants tools as a JSON list and answers with a  *
 * JSON list of {"name","arguments"} (or "[]"). A `respond` pseudo-tool carries the     *
 * spoken answer. No grammar — the list shape isn't our object shape.                   */

const HAMMER_TASK = `You are a tool calling assistant. In order to complete the user's request, you need to select one or more appropriate tools from the following tools and fill in the correct values for the tool parameters. Your specific tasks are:
1. Make one or more function/tool calls to meet the request based on the question.
2. If none of the function can be used, point it out and refuse to answer.
3. If the given question lacks the parameters required by the function, also point it out.

The following are characters that may interact with you
1. user: Provides query or additional information.
2. tool: Returns the results of the tool calling.`

const HAMMER_FORMAT = `
The output MUST strictly adhere to the following JSON format, and NO other text MUST be included.
The example format is as follows. Please make sure the parameter type is correct. If no function call is needed, please directly output an empty list '[]'
\`\`\`
[
    {"name": "func_name1", "arguments": {"argument1": "value1", "argument2": "value2"}},
    ... (more tool calls as required)
]
\`\`\``

const RESPOND_TOOL = {
  name: 'respond',
  description: 'Speak a short answer aloud to the user. Use this once a tool result lets you answer, or for anything that needs no tool. Keep it to one short sentence.',
  parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
}

// runAgent embeds our own {"say":…}-shaped nudges in user/tool turns; Hammer parrots them
// verbatim. Strip them and re-steer in Hammer's own terms.
function sanitizeForHammer(content, isTool) {
  let c = String(content)
    .replace(/\n?(You now have what you need\.|Now reply|Reply now with exactly|Reply with ONE JSON object only:|Use \{"tool").*$/is, '')
    .trim()
  if (isTool) c += '\n\nNow call `respond` with a one-sentence answer for the user.'
  return c
}

function hammerPrompt({ messages }) {
  const toolList = JSON.stringify([...TOOL_DEFS, RESPOND_TOOL])
  let s = '<|im_start|>system\nYou are a hands-free gym workout voice assistant.<|im_end|>\n'
  s += `<|im_start|>user\n[BEGIN OF TASK INSTRUCTION]\n${HAMMER_TASK}\n[END OF TASK INSTRUCTION]\n\n`
  s += `[BEGIN OF AVAILABLE_TOOLS]\n${toolList}\n[END OF AVAILABLE_TOOLS]\n\n\n`
  s += `[BEGIN OF TASK INSTRUCTION]\n${HAMMER_FORMAT}\n[END OF TASK INSTRUCTION]\n\n<|im_end|>\n`
  for (const m of messages) {
    if (m.role === 'assistant') {
      let c = m.content
      try { const o = JSON.parse(m.content); if (o.tool) c = '```\n' + JSON.stringify([{ name: o.tool, arguments: o.args || {} }]) + '\n```' } catch { /* leave as-is */ }
      s += `<|im_start|>assistant\n${c}<|im_end|>\n`
    } else if (m.role === 'tool') {
      s += `<|im_start|>tool\n${sanitizeForHammer(m.content, true)}<|im_end|>\n`
    } else {
      s += `<|im_start|>user\n${sanitizeForHammer(m.content, false)}<|im_end|>\n`
    }
  }
  return s + '<|im_start|>assistant\n'
}

export const hammerFormat = {
  build: ({ messages }) => ({ prompt: hammerPrompt({ messages }), grammar: '' }),
  parse: raw => {
    const t = String(raw || '').replace(/<\|im_end\|>[\s\S]*$/, '').replace(/```(json)?/gi, '').trim()
    if (/^\[\s*]$/.test(t)) return JSON.stringify({})   // empty list → let runAgent re-nudge
    let call = null
    const arr = t.match(/\[\s*{[\s\S]*}\s*]/)
    if (arr) { try { call = JSON.parse(arr[0])[0] } catch { /* fall through */ } }
    if (!call) { const obj = t.match(/{[\s\S]*}/); if (obj) { try { call = JSON.parse(obj[0]) } catch { /* fall through */ } } }
    if (call && typeof call.say === 'string') return JSON.stringify({ say: call.say })
    if (call && call.name === 'respond') return JSON.stringify({ say: (call.arguments && call.arguments.message) || '' })
    if (call && call.name) return JSON.stringify({ tool: call.name, args: call.arguments || {} })
    return t ? JSON.stringify({ say: t }) : JSON.stringify({})
  },
}

/* ============================ lfm2-tool — LFM2-1.2B-Tool ========================== *
 * Kept for the benchmark; not shipped (35% tool selection). Pythonic [fn(a=b)] calls. */

const pyKwargs = obj => Object.entries(obj)
  .map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`).join(', ')

function parsePyKwargs(s) {
  const out = {}
  const re = /([A-Za-z_]\w*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+\.?\d*|true|false|None)/g
  let m
  while ((m = re.exec(s))) {
    let v = m[2]
    if (v[0] === '"' || v[0] === "'") v = v.slice(1, -1)
    else if (v === 'true') v = true
    else if (v === 'false') v = false
    else if (v === 'None') v = null
    else v = Number(v)
    out[m[1]] = v
  }
  return out
}

export const lfm2ToolFormat = {
  build: ({ messages }) => {
    const toolList = TOOL_DEFS.map(t => JSON.stringify(t)).join(', ')
    let s = `<|im_start|>system\nYou are a hands-free gym workout voice assistant. List of tools: <|tool_list_start|>[${toolList}]<|tool_list_end|><|im_end|>\n`
    for (const m of messages) {
      if (m.role === 'assistant') {
        let c = m.content
        try { const o = JSON.parse(m.content); if (o.tool) c = `<|tool_call_start|>[${o.tool}(${pyKwargs(o.args || {})})]<|tool_call_end|>` } catch { /* leave */ }
        s += `<|im_start|>assistant\n${c}<|im_end|>\n`
      } else if (m.role === 'tool') {
        s += `<|im_start|>tool\n<|tool_response_start|>${m.content}<|tool_response_end|><|im_end|>\n`
      } else {
        s += `<|im_start|>user\n${m.content}<|im_end|>\n`
      }
    }
    return { prompt: s + '<|im_start|>assistant\n', grammar: '' }
  },
  parse: raw => {
    const t = String(raw || '')
    const m = t.match(/\[\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*]/)
    if (m) return JSON.stringify({ tool: m[1], args: parsePyKwargs(m[2]) })
    return JSON.stringify({ say: t.replace(/<\|[^|]*\|>/g, '').trim() })
  },
}

export const FORMATS = { chatml: chatmlFormat, hammer: hammerFormat, 'lfm2-tool': lfm2ToolFormat }

// Pick an adapter from a gguf filename (benchmark convenience).
export function formatForFile(path) {
  const f = String(path).toLowerCase()
  if (f.includes('hammer')) return 'hammer'
  if (f.includes('lfm2') && f.includes('tool')) return 'lfm2-tool'
  return 'chatml'
}
