// Milestone 4 — on-device LLM agent loop.
//
// transcript → LLM (system prompt + tool schemas + a state snapshot) → it emits ONE json
// object per turn: {"tool": name, "args": {...}} to call a tool, or {"say": "..."} to
// answer. Tool result is fed back; repeat until it says something or the step budget runs
// out. The `generate` function is supplied by the native llama.cpp plugin; this module is
// transport-agnostic and fully unit-testable with a scripted generate().

import { TOOLS, runTool } from './voice-tools.js'

const MAX_STEPS = 5

export function buildSystemPrompt(tools = TOOLS) {
  const lines = tools.map(t => {
    const p = t.parameters?.properties || {}
    const args = Object.keys(p).length
      ? Object.entries(p).map(([k, v]) => `${k}${(t.parameters.required || []).includes(k) ? '' : '?'}:${v.type}`).join(', ')
      : ''
    return `- ${t.name}(${args}) — ${t.description}`
  })
  return [
    'You are the voice assistant inside a gym-tracking app. The user is mid-workout and talking hands-free.',
    'You can call tools to read their training data and to control the current workout.',
    '',
    'Tools:',
    ...lines,
    '',
    'Every reply is exactly ONE JSON object, nothing else:',
    '  {"tool": "<name>", "args": { ... }}   to call a tool',
    '  {"say": "<short spoken sentence>"}     to answer the user',
    'Call tools until you can answer, then say something. Keep spoken replies to one or two',
    'short sentences — they are read aloud. Never invent numbers; get them from a tool.',
  ].join('\n')
}

// A compact snapshot so trivial questions need no tool call.
export function stateSnapshot() {
  const s = runTool('get_workout_state')
  if (!s.active) return `No workout running. Today's plan: ${s.todayPlan}.`
  return `Workout: ${s.routine}. Exercise ${s.exerciseIndex}/${s.exerciseCount} (${s.currentExercise}, target ${s.currentTarget}). ` +
    `${s.setsDone}/${s.setsTotal} sets done, ${s.elapsedMin} min elapsed.`
}

// Pull the first balanced {...} out of possibly-fenced, possibly-chatty model output.
export function extractJson(text) {
  if (!text) return null
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)) } catch { return null } } }
  }
  return null
}

/**
 * @param {string} transcript
 * @param {(req:{system:string,messages:{role:string,content:string}[]}) => Promise<string>} generate
 * @param {{tools?:typeof TOOLS, maxSteps?:number, onStep?:Function}} [opts]
 * @returns {Promise<{ speak:string, steps:{tool?:string,args?:object,result?:object,say?:string}[], transcript:string }>}
 */
export async function runAgent(transcript, generate, opts = {}) {
  const tools = opts.tools || TOOLS
  const maxSteps = opts.maxSteps || MAX_STEPS
  const system = buildSystemPrompt(tools)
  const messages = [
    { role: 'user', content: `[state] ${stateSnapshot()}\n\n${transcript}` },
  ]
  const steps = []

  for (let i = 0; i < maxSteps; i++) {
    let raw
    try { raw = await generate({ system, messages }) }
    catch (e) { return { speak: 'The assistant model failed to respond.', steps, transcript, error: String(e?.message || e) } }

    const obj = extractJson(raw)
    if (!obj) {
      messages.push({ role: 'assistant', content: raw || '' })
      messages.push({ role: 'user', content: 'Reply with ONE JSON object only: {"tool":...} or {"say":...}.' })
      continue
    }
    if (typeof obj.say === 'string') {
      steps.push({ say: obj.say })
      opts.onStep?.(steps[steps.length - 1])
      return { speak: obj.say, steps, transcript }
    }
    if (obj.tool) {
      const result = runTool(obj.tool, obj.args || {})
      const step = { tool: obj.tool, args: obj.args || {}, result }
      steps.push(step)
      opts.onStep?.(step)
      messages.push({ role: 'assistant', content: JSON.stringify({ tool: obj.tool, args: obj.args || {} }) })
      messages.push({ role: 'tool', name: obj.tool, content: JSON.stringify(result) })
      continue
    }
    // shape we don't recognise
    messages.push({ role: 'user', content: 'Use {"tool":...} or {"say":...}.' })
  }

  // ran out of steps — say the last tool's message if we have one
  const last = [...steps].reverse().find(s => s.result?.message)
  return { speak: last?.result.message || "I couldn't work that out.", steps, transcript, exhausted: true }
}
