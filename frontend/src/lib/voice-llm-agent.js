// Milestone 4 — on-device LLM agent loop.
//
// transcript → LLM (system prompt + tool schemas + a state snapshot) → it emits ONE json
// object per turn: {"tool": name, "args": {...}} to call a tool, or {"say": "..."} to
// answer. Tool result is fed back; repeat until it says something or the step budget runs
// out. The `generate` function is supplied by the native llama.cpp plugin; this module is
// transport-agnostic and fully unit-testable with a scripted generate().

import { TOOLS, runTool } from './voice-tools.js'

const MAX_STEPS = 3

// Terse — the system prompt is re-processed on every agent turn, so every token costs.
const SHORT = {
  get_workout_state: 'current exercise, sets done/total, minutes elapsed',
  get_session_summary: "today's exercises, sets, volume, duration",
  get_exercise_history: 'past sets, 1RM, trend for one lift (exercise, weeks?)',
  get_stats: 'totals over week|month|year|all (range?)',
  get_plan: 'weekly routine schedule',
  get_bodyweight: 'latest body weight + 30-day change',
  log_set: 'log current set (reps?, weight?, seconds?)',
  set_weight: 'set weight on current set (weight)',
  set_reps: 'set reps on current set (reps)',
  add_set: 'add a set', remove_set: 'remove last set',
  next_exercise: 'go to next exercise', prev_exercise: 'go to previous exercise',
  start_rest: 'start rest timer (seconds?)', stop_rest: 'skip rest',
  swap_exercise: 'replace current exercise (to)',
  set_bodyweight: "log today's body weight (weight)",
  finish_workout: 'end and save the workout',
}

export function buildSystemPrompt(tools = TOOLS) {
  const lines = tools.map(t => `- ${t.name}: ${SHORT[t.name] || t.description}`)
  return [
    'You are a hands-free voice assistant in a gym app. Reply with exactly ONE JSON object:',
    '{"tool":"NAME","args":{...}} to call a tool, or {"say":"one short sentence"} to answer aloud.',
    'Call a tool to get real numbers, then say the answer. Never guess numbers.',
    '',
    'TOOLS:',
    ...lines,
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
