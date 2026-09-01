// Milestone 3 dispatcher — turns a parsed { intent, args } into a mutation on the live
// workout and a short line to speak back. Operates purely through the stores, so it can
// run from anywhere (the mic button, later the LLM agent loop).

import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from './exercises.js'
import { supersetUnits, unitOf, modeOf, isBw, lastEntryFor, setLabel } from './history.js'
import { finishWorkout } from '../sheets.jsx'
import { t } from './i18n.js'
import { fmtNum } from './format.js'

const S = () => useStore.getState().S
const update = (fn, push = true) => useStore.getState().update(fn, push)

function ctx() {
  const st = S()
  const A = st.active
  if (!A) return null
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur || 0, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  return { st, A, units, cur, unit, unitIdx }
}

// entry in the current unit that still has an unfinished set (or the anchor entry)
function activeEntryIdx(c) {
  for (const i of c.unit) if (c.A.entries[i].sets.some(s => !s.done)) return i
  return c.cur
}
function firstUndoneSet(entry) {
  const i = entry.sets.findIndex(s => !s.done)
  return i === -1 ? null : i
}
const exName = id => exOr(id).n.replace(/\b\w/g, ch => ch.toUpperCase())

function newSetLike(entry) {
  const l = entry.sets[entry.sets.length - 1]
  const m = modeOf({ ...(entry.target || {}), id: entry.id })
  if (m === 'cardio') return { min: l ? l.min : (entry.target?.min || 20), speed: l ? l.speed : (entry.target?.speed || 8), done: false }
  if (m === 'time') return { sec: l ? l.sec : (entry.target?.sec || 45), w: l ? (l.w || 0) : (entry.target?.weight || 0), done: false }
  return { w: l ? l.w : 0, r: l ? l.r : (entry.target?.reps || 8), done: false }
}

// ---- individual handlers -------------------------------------------------------

function logSet(args) {
  const c = ctx()
  if (!c) return 'No workout is running. Start one first.'
  const idx = activeEntryIdx(c)
  const entry = c.A.entries[idx]
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const bw = mode === 'reps' && isBw({ ...(entry.target || {}), id: entry.id })

  let setNo
  update(s => {
    const e = s.active.entries[idx]
    let i = firstUndoneSet(e)
    if (i == null) { e.sets.push(newSetLike(e)); i = e.sets.length - 1 }
    if (args.weight != null && !bw) e.sets[i].w = args.weight
    if (args.weight != null && bw && args.weight > 0) e.sets[i].w = args.weight
    if (args.reps != null) e.sets[i].r = args.reps
    e.sets[i].done = true
    setNo = i + 1
  })

  // rest / advance, mirroring Workout.jsx toggle()
  const c2 = ctx()
  const e2 = c2.A.entries[idx]
  const unitDone = c2.unit.every(ui => c2.A.entries[ui].sets.every(x => x.done))
  const isLastExInUnit = idx === c2.unit[c2.unit.length - 1]
  const isLastUnit = c2.unitIdx >= c2.units.length - 1
  if (isLastExInUnit && !unitDone) useUI.getState().startRest(c2.st.restSec)
  else if (unitDone) useUI.getState().stopRest()
  if (unitDone && !isLastUnit) update(s => { s.active.cur = c2.units[c2.unitIdx + 1][0] }, false)

  const w = e2.sets[setNo - 1].w
  const r = e2.sets[setNo - 1].r
  const load = (!bw && w) ? `${fmtNum(w)} ${c2.st.unit} for ` : (bw && w ? `plus ${fmtNum(w)} ${c2.st.unit}, ` : '')
  let msg = `Set ${setNo} logged: ${load}${r} reps.`
  if (unitDone && !isLastUnit) msg += ` Next: ${exName(ctx().A.entries[ctx().cur].id)}.`
  else if (unitDone && isLastUnit) msg += ` That's the last exercise — say "finish workout" when you're ready.`
  else if (isLastExInUnit) msg += ` Resting ${c2.st.restSec} seconds.`
  return msg
}

function setValue(field, args) {
  const c = ctx()
  if (!c) return 'No workout is running.'
  const idx = activeEntryIdx(c)
  const val = field === 'w' ? args.weight : args.reps
  if (val == null) return "I didn't catch the number."
  update(s => {
    const e = s.active.entries[idx]
    const i = firstUndoneSet(e) ?? e.sets.length - 1
    e.sets[i][field] = val
  })
  return field === 'w' ? `Weight set to ${fmtNum(val)} ${c.st.unit}.` : `Reps set to ${fmtNum(val)}.`
}

function addSet() {
  const c = ctx()
  if (!c) return 'No workout is running.'
  const idx = activeEntryIdx(c)
  let n
  update(s => { const e = s.active.entries[idx]; e.sets.push(newSetLike(e)); n = e.sets.length })
  return `Added a set — ${n} now.`
}

function removeSet() {
  const c = ctx()
  if (!c) return 'No workout is running.'
  const idx = activeEntryIdx(c)
  let n, removed = false
  update(s => { const e = s.active.entries[idx]; if (e.sets.length > 1) { e.sets.pop(); removed = true } n = e.sets.length })
  return removed ? `Removed a set — ${n} left.` : "There's only one set."
}

function move(dir) {
  const c = ctx()
  if (!c) return 'No workout is running.'
  const to = c.unitIdx + dir
  if (to < 0) return "You're on the first exercise."
  if (to >= c.units.length) return "You're on the last exercise."
  update(s => { s.active.cur = c.units[to][0] }, false)
  return `${dir > 0 ? 'Next' : 'Back'} — ${exName(ctx().A.entries[ctx().cur].id)}.`
}

function startRest(args) {
  const c = ctx()
  const sec = args.seconds || c?.st.restSec || 90
  useUI.getState().startRest(sec)
  return `Resting ${sec} seconds.`
}
function stopRest() {
  useUI.getState().stopRest()
  return 'Rest skipped.'
}

function whatsTarget() {
  const c = ctx()
  if (!c) return 'No workout is running.'
  const e = c.A.entries[activeEntryIdx(c)]
  const p = e.plan
  const name = exName(e.id)
  if (!p || p.kind === 'off' || !p.why) {
    const tgt = e.target || {}
    return `${name}: ${tgt.sets || e.sets.length} sets of ${tgt.repsMin ? tgt.repsMin + ' to ' + tgt.reps : tgt.reps || e.sets[0]?.r} reps.`
  }
  let line = `${name}: `
  if (p.weight != null) line += `${fmtNum(p.weight)} ${c.st.unit} `
  if (p.reps != null) line += `for ${p.reps} reps. `
  try { line += t(...p.why) } catch { /* template needs args we don't have */ }
  return line.trim()
}

function lastTime() {
  const c = ctx()
  if (!c) return 'No workout is running.'
  const e = c.A.entries[activeEntryIdx(c)]
  const last = lastEntryFor(c.st, e.id)
  if (!last) return `No history for ${exName(e.id)} yet.`
  const sets = last.sets.map(s => setLabel(e.id, s, last.target)).join(', ')
  return `Last time on ${exName(e.id)}: ${sets}.`
}

function howManySets() {
  const c = ctx()
  if (!c) return 'No workout is running.'
  const total = c.A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = c.A.entries.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)
  return `${done} of ${total} sets done. Exercise ${c.unitIdx + 1} of ${c.units.length}.`
}

function finish() {
  if (!S().active) return 'No workout is running.'
  finishWorkout()
  return 'Wrapping up your workout.'
}

// ---- entry point -------------------------------------------------------

export function runIntent({ intent, args = {} }) {
  switch (intent) {
    case 'log_set': return logSet(args)
    case 'mark_done': return logSet({})
    case 'set_weight': return setValue('w', args)
    case 'set_reps': return setValue('r', args)
    case 'add_set': return addSet()
    case 'remove_set': return removeSet()
    case 'next_exercise': return move(1)
    case 'prev_exercise': return move(-1)
    case 'start_rest': return startRest(args)
    case 'stop_rest': return stopRest()
    case 'whats_target': return whatsTarget()
    case 'last_time': return lastTime()
    case 'how_many_sets': return howManySets()
    case 'finish_workout': return finish()
    case 'cancel': return 'Okay.'
    case 'empty': return "I didn't hear anything."
    default: return "I didn't catch that. Try: log 8 reps at 60 kilos, next exercise, start rest, or what's my target."
  }
}
