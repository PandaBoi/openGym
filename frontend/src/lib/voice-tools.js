// The workout tool interface for the voice assistant.
//
// One registry of typed tools — queries that read the training data and actions that
// mutate the live workout — each returning plain JSON. Shared by:
//   · voice-agent.js  (Milestone 3: a regex intent maps 1:1 to one tool)
//   · voice-llm-agent.js (Milestone 4: an on-device LLM picks tools in a loop)
//
// Everything runs through the same Zustand stores the UI uses. No network.

import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from './exercises.js'
import { matchExercise } from './import-csv.js'
import {
  supersetUnits, unitOf, modeOf, isBw, lastEntryFor, setLabel,
  workoutVolume, setsDone, streakWeeks, lastBW,
} from './history.js'
import { best1RM } from './onerm.js'
import { nextPrescription, applyPrescription } from './progression.js'
import { buildSets } from './history.js'
import { finishWorkout } from '../sheets.jsx'
import { fmtNum } from './format.js'

const S = () => useStore.getState().S
const update = (fn, push = true) => useStore.getState().update(fn, push)
const unit = () => S().unit
const titleCase = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase())
const exName = id => titleCase(exOr(id).n)

/* --------------------------------------------------------- live-workout ctx ---- */

export function ctx() {
  const st = S()
  const A = st.active
  if (!A) return null
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur || 0, Math.max(0, A.entries.length - 1))
  const unitArr = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unitArr)
  return { st, A, units, cur, unit: unitArr, unitIdx }
}
export function activeEntryIdx(c) {
  for (const i of c.unit) if (c.A.entries[i].sets.some(s => !s.done)) return i
  return c.cur
}
const firstUndone = e => { const i = e.sets.findIndex(s => !s.done); return i === -1 ? null : i }
function newSetLike(e) {
  const l = e.sets[e.sets.length - 1]
  const m = modeOf({ ...(e.target || {}), id: e.id })
  if (m === 'cardio') return { min: l ? l.min : (e.target?.min || 20), speed: l ? l.speed : (e.target?.speed || 8), done: false }
  if (m === 'time') return { sec: l ? l.sec : (e.target?.sec || 45), w: l ? (l.w || 0) : (e.target?.weight || 0), done: false }
  return { w: l ? l.w : 0, r: l ? l.r : (e.target?.reps || 8), done: false }
}
const noWorkout = { ok: false, message: 'No workout is running. Say "start workout" first.' }

/* ----------------------------------------------------------------- actions ---- */

function log_set({ reps, weight, seconds } = {}) {
  const c = ctx()
  if (!c) return noWorkout
  const idx = activeEntryIdx(c)
  const e0 = c.A.entries[idx]
  const mode = modeOf({ ...(e0.target || {}), id: e0.id })
  const bw = mode === 'reps' && isBw({ ...(e0.target || {}), id: e0.id })
  let setNo
  update(s => {
    const e = s.active.entries[idx]
    let i = firstUndone(e)
    if (i == null) { e.sets.push(newSetLike(e)); i = e.sets.length - 1 }
    if (weight != null && (!bw || weight > 0)) e.sets[i].w = weight
    if (reps != null) e.sets[i].r = reps
    if (seconds != null) e.sets[i].sec = seconds
    e.sets[i].done = true
    setNo = i + 1
  })
  // rest / advance, mirroring Workout.jsx toggle()
  const c2 = ctx()
  const e2 = c2.A.entries[idx]
  const unitDone = c2.unit.every(ui => c2.A.entries[ui].sets.every(x => x.done))
  const isLastInUnit = idx === c2.unit[c2.unit.length - 1]
  const isLastUnit = c2.unitIdx >= c2.units.length - 1
  let rest = 0
  if (isLastInUnit && !unitDone) { useUI.getState().startRest(c2.st.restSec); rest = c2.st.restSec }
  else if (unitDone) useUI.getState().stopRest()
  let advancedTo = null
  if (unitDone && !isLastUnit) { update(s => { s.active.cur = c2.units[c2.unitIdx + 1][0] }, false); advancedTo = exName(ctx().A.entries[ctx().cur].id) }
  const set = e2.sets[setNo - 1]
  return {
    ok: true,
    setNumber: setNo,
    logged: bw ? { reps: set.r, addedWeight: set.w || 0 } : mode === 'time' ? { seconds: set.sec } : { weight: set.w, reps: set.r },
    unit: unit(),
    exercise: exName(e2.id),
    setsLeftInExercise: e2.sets.filter(x => !x.done).length,
    restStarted: rest || undefined,
    advancedTo: advancedTo || undefined,
    workoutComplete: unitDone && isLastUnit || undefined,
    message: `Set ${setNo} logged on ${exName(e2.id)}` +
      (advancedTo ? `. Next: ${advancedTo}.` : rest ? `. Resting ${rest}s.` : (unitDone && isLastUnit) ? '. That was the last exercise.' : '.'),
  }
}

function setField(field, val, label) {
  const c = ctx()
  if (!c) return noWorkout
  if (val == null) return { ok: false, message: `No ${label} value given.` }
  const idx = activeEntryIdx(c)
  update(s => { const e = s.active.entries[idx]; const i = firstUndone(e) ?? e.sets.length - 1; e.sets[i][field] = val })
  return { ok: true, [label]: val, unit: field === 'w' ? unit() : undefined, message: `${titleCase(label)} set to ${fmtNum(val)}${field === 'w' ? ' ' + unit() : ''}.` }
}

// count > 1 for "add three sets". A new set copies the previous one's numbers (newSetLike),
// which is exactly what "add 4 sets, copy the previous" asks for.
function addRemoveSet(delta, count = 1) {
  const c = ctx()
  if (!c) return noWorkout
  const idx = activeEntryIdx(c)
  const want = Math.max(1, Math.min(20, Math.round(count) || 1))
  let n, done = 0
  update(s => {
    const e = s.active.entries[idx]
    for (let k = 0; k < want; k++) {
      if (delta > 0) { e.sets.push(newSetLike(e)); done++ }
      else if (e.sets.length > 1) { e.sets.pop(); done++ }
    }
    n = e.sets.length
  })
  if (!done) return { ok: false, sets: n, message: 'There is only one set.' }
  const what = done === 1 ? 'a set' : `${done} sets`
  return { ok: true, sets: n, message: `${delta > 0 ? 'Added' : 'Removed'} ${what} — ${n} now.` }
}

function move(dir) {
  const c = ctx()
  if (!c) return noWorkout
  const to = c.unitIdx + dir
  if (to < 0) return { ok: false, message: "Already on the first exercise." }
  if (to >= c.units.length) return { ok: false, message: "Already on the last exercise." }
  update(s => { s.active.cur = c.units[to][0] }, false)
  const name = exName(ctx().A.entries[ctx().cur].id)
  return { ok: true, exercise: name, exerciseIndex: to + 1, exerciseCount: c.units.length, message: `${dir > 0 ? 'Next' : 'Back'} — ${name}.` }
}

function start_rest({ seconds } = {}) {
  const c = ctx()
  const sec = seconds || c?.st.restSec || 90
  useUI.getState().startRest(sec)
  return { ok: true, seconds: sec, message: `Resting ${sec} seconds.` }
}
function stop_rest() { useUI.getState().stopRest(); return { ok: true, message: 'Rest stopped.' } }

function swap_exercise({ to } = {}) {
  const c = ctx()
  if (!c) return noWorkout
  if (!to) return { ok: false, message: 'Which exercise should I swap in?' }
  const id = matchExercise(to)
  if (!id) return { ok: false, message: `Couldn't find an exercise called "${to}".` }
  const idx = activeEntryIdx(c)
  const fromName = exName(c.A.entries[idx].id)
  update(s => {
    const e = s.active.entries[idx]
    e.id = id
    const full = { ...(e.target || {}), id }
    const routine = s.routines.find(r => r.id === s.active.routineId)
    e.plan = nextPrescription(s, full, routine)
    e.sets = applyPrescription(buildSets(s, full), e.plan)
    delete e.asked
  })
  return { ok: true, from: fromName, to: exName(id), message: `Swapped ${fromName} for ${exName(id)}.` }
}

function set_bodyweight({ weight } = {}) {
  if (weight == null) return { ok: false, message: 'What body weight?' }
  const today = new Date().toISOString().slice(0, 10)
  update(s => {
    const i = s.bodyweight.findIndex(b => b.d === today)
    const row = { d: today, w: weight, t: Date.now() }
    if (i === -1) s.bodyweight.push(row); else s.bodyweight[i] = row
    s.bodyweight.sort((a, b) => a.d.localeCompare(b.d))
  })
  return { ok: true, weight, unit: unit(), message: `Body weight logged: ${fmtNum(weight)} ${unit()}.` }
}

function finish_workout() {
  if (!S().active) return noWorkout
  finishWorkout()
  return { ok: true, message: 'Wrapping up the workout.' }
}

/* ----------------------------------------------------------------- queries ---- */

function get_workout_state() {
  const c = ctx()
  if (!c) {
    const st = S()
    return { active: false, todayPlan: st.routines.find(r => r.id === (st.week[new Date().getDay()]))?.name || 'rest day' }
  }
  const { A, units, unitIdx } = c
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = A.entries.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)
  const e = A.entries[activeEntryIdx(c)]
  return {
    active: true,
    routine: A.name,
    elapsedMin: Math.round((Date.now() - A.start) / 60000),
    exerciseIndex: unitIdx + 1,
    exerciseCount: units.length,
    currentExercise: exName(e.id),
    currentTarget: e.plan?.weight != null ? `${fmtNum(e.plan.weight)} ${unit()} x ${e.plan.reps ?? e.target?.reps}` : `${e.target?.reps ?? ''} reps`,
    setsDone: done,
    setsTotal: total,
    exercisesDone: units.filter(u => u.every(i => A.entries[i].sets.length && A.entries[i].sets.every(s => s.done))).map(u => exName(A.entries[u[0]].id)),
    exercisesRemaining: units.filter(u => u.some(i => A.entries[i].sets.some(s => !s.done))).map(u => exName(A.entries[u[0]].id)),
  }
}

function get_session_summary() {
  const st = S()
  const A = st.active
  if (A) {
    const done = setsDone({ entries: A.entries })
    let vol = 0
    A.entries.forEach(e => e.sets.forEach(s => { if (s.done) vol += (s.w || 0) * (s.r || 0) }))
    return { inProgress: true, routine: A.name, durationMin: Math.round((Date.now() - A.start) / 60000), setsDone: done, volume: Math.round(vol), unit: unit() }
  }
  const today = new Date().toISOString().slice(0, 10)
  const ws = st.workouts.filter(w => w.d === today)
  if (!ws.length) return { inProgress: false, loggedToday: false, message: 'No workout logged today yet.' }
  return {
    inProgress: false, loggedToday: true, count: ws.length,
    sessions: ws.map(w => ({
      routine: w.name,
      durationMin: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
      exercises: w.entries.length,
      sets: setsDone(w),
      volume: Math.round(w.vol ?? workoutVolume(w)),
      prs: (w.prs || []).map(exName),
    })),
    unit: unit(),
  }
}

function get_exercise_history({ exercise, weeks = 8 } = {}) {
  const st = S()
  if (!exercise) return { ok: false, message: 'Which exercise?' }
  const id = matchExercise(exercise) || st.customEx.find(c => c.n.toLowerCase() === exercise.toLowerCase())?.id
  if (!id) return { ok: false, message: `No exercise called "${exercise}".` }
  const since = Date.now() - weeks * 7 * 864e5
  const sessions = st.workouts
    .filter(w => new Date(w.d).getTime() >= since)
    .map(w => ({ w, e: w.entries.find(x => x.id === id) }))
    .filter(x => x.e)
    .sort((a, b) => a.w.d.localeCompare(b.w.d))
    .map(({ w, e }) => {
      const dl = e.sets.filter(s => s.done)
      const top = dl.reduce((m, s) => (!m || (s.w || 0) > (m.w || 0) ? s : m), null)
      return { date: w.d, sets: dl.map(s => ({ weight: s.w, reps: s.r })), topSet: top ? `${fmtNum(top.w || 0)}x${top.r}` : null }
    })
  return {
    exercise: exName(id), unit: unit(), weeks,
    sessionCount: sessions.length,
    sessions: sessions.slice(-8),
    bestE1RM: best1RM(st, id) ? Math.round(best1RM(st, id)) : null,
    trend: sessions.length >= 2
      ? ((sessions.at(-1).sets[0]?.weight || 0) - (sessions[0].sets[0]?.weight || 0) >= 0 ? 'up' : 'down')
      : 'flat',
  }
}

function get_stats({ range = 'month' } = {}) {
  const st = S()
  const now = Date.now()
  const cut = range === 'week' ? now - 7 * 864e5 : range === 'year' ? now - 365 * 864e5 : range === 'all' ? 0 : now - 30 * 864e5
  const ws = st.workouts.filter(w => new Date(w.d).getTime() >= cut)
  let sets = 0, vol = 0, ms = 0
  const prs = new Set()
  ws.forEach(w => {
    sets += setsDone(w)
    vol += w.vol ?? workoutVolume(w)
    if (w.start && w.end) ms += w.end - w.start
    ;(w.prs || []).forEach(id => prs.add(exName(id)))
  })
  return {
    range, workouts: ws.length, sets, volume: Math.round(vol), unit: unit(),
    hoursTraining: Math.round(ms / 3.6e6 * 10) / 10,
    weekStreak: streakWeeks(st),
    prs: [...prs],
  }
}

function get_plan() {
  const st = S()
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return {
    week: days.map((day, i) => {
      const r = st.routines.find(x => x.id === st.week[i])
      return { day, routine: r ? r.name : 'rest', exercises: r ? r.ex.map(e => exName(e.id)) : [] }
    }).filter(d => d.routine !== 'rest'),
  }
}

function get_bodyweight() {
  const st = S()
  const last = lastBW(st)
  if (!last) return { logged: false, message: 'No body weight logged.' }
  const monthAgo = st.bodyweight.filter(b => Date.now() - new Date(b.d).getTime() <= 31 * 864e5)[0]
  return {
    logged: true, latest: last.w, unit: unit(), date: last.d,
    change30d: monthAgo ? Math.round((last.w - monthAgo.w) * 10) / 10 : null,
  }
}

/* --------------------------------------------------------------- registry ---- */

const num = d => ({ type: 'number', description: d })
export const TOOLS = [
  // queries
  { name: 'get_workout_state', description: "The current guided workout: which exercise, sets done vs total, minutes elapsed, what's left.", parameters: { type: 'object', properties: {} }, run: get_workout_state },
  { name: 'get_session_summary', description: 'Summary of the workout in progress, or of what was logged today.', parameters: { type: 'object', properties: {} }, run: get_session_summary },
  { name: 'get_exercise_history', description: 'Past sets, best estimated 1RM and trend for one exercise.', parameters: { type: 'object', properties: { exercise: { type: 'string' }, weeks: num('lookback window, default 8') }, required: ['exercise'] }, run: get_exercise_history },
  { name: 'get_stats', description: 'Training totals over a period: workouts, sets, volume, hours, week streak, PRs.', parameters: { type: 'object', properties: { range: { type: 'string', enum: ['week', 'month', 'year', 'all'] } } }, run: get_stats },
  { name: 'get_plan', description: 'The weekly routine schedule and the exercises in each day.', parameters: { type: 'object', properties: {} }, run: get_plan },
  { name: 'get_bodyweight', description: 'Latest body weight and 30-day change.', parameters: { type: 'object', properties: {} }, run: get_bodyweight },
  // actions
  { name: 'log_set', description: 'Log the current set. Give reps and weight, or reps alone for bodyweight, or seconds for a timed hold.', parameters: { type: 'object', properties: { reps: num('reps performed'), weight: num('weight in the user unit'), seconds: num('hold time for timed exercises') } }, run: log_set },
  { name: 'set_weight', description: 'Set the weight on the current set without logging it.', parameters: { type: 'object', properties: { weight: num('') }, required: ['weight'] }, run: a => setField('w', a.weight, 'weight') },
  { name: 'set_reps', description: 'Set the rep target on the current set without logging it.', parameters: { type: 'object', properties: { reps: num('') }, required: ['reps'] }, run: a => setField('r', a.reps, 'reps') },
  { name: 'add_set', description: 'Add one or more sets to the current exercise (each copies the previous set).', parameters: { type: 'object', properties: { count: num('how many sets, default 1') } }, run: a => addRemoveSet(1, a?.count) },
  { name: 'remove_set', description: 'Remove one or more sets from the end of the current exercise.', parameters: { type: 'object', properties: { count: num('how many sets, default 1') } }, run: a => addRemoveSet(-1, a?.count) },
  { name: 'next_exercise', description: 'Move to the next exercise / superset.', parameters: { type: 'object', properties: {} }, run: () => move(1) },
  { name: 'prev_exercise', description: 'Move to the previous exercise / superset.', parameters: { type: 'object', properties: {} }, run: () => move(-1) },
  { name: 'start_rest', description: 'Start the rest timer.', parameters: { type: 'object', properties: { seconds: num('default: the user setting') } }, run: start_rest },
  { name: 'stop_rest', description: 'Stop / skip the rest timer.', parameters: { type: 'object', properties: {} }, run: stop_rest },
  { name: 'swap_exercise', description: 'Replace the current exercise with a different one.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'exercise to switch to' } }, required: ['to'] }, run: swap_exercise },
  { name: 'set_bodyweight', description: "Log today's body weight.", parameters: { type: 'object', properties: { weight: num('') }, required: ['weight'] }, run: set_bodyweight },
  { name: 'finish_workout', description: 'End and save the current workout.', parameters: { type: 'object', properties: {} }, run: finish_workout },
]

export const TOOL_MAP = Object.fromEntries(TOOLS.map(t => [t.name, t]))

export function runTool(name, args = {}) {
  const t = TOOL_MAP[name]
  if (!t) return { ok: false, error: `unknown tool "${name}"` }
  try { return t.run(args || {}) }
  catch (e) { return { ok: false, error: String(e?.message || e) } }
}
