// Saved circuits — reusable finishers you build once and drop into (or swap into) any
// routine. A circuit is `{ id, label, rounds, ex: [cfg…] }` living in `S.circuits`; each
// `ex` is an exercise config shaped like a routine entry but without `sets`/progression —
// rounds replace sets and a circuit never progresses (it's conditioning).
//
// When a saved circuit is placed in a routine, its id is stamped on the group's circuit
// meta as `cg[sg].cid`, so finished workouts can be grouped back by which circuit they ran.

import { uid } from './format.js'
import { modeOf } from './history.js'

export const newCircuit = label => ({ id: 'c' + uid(), label: label || '', rounds: 3, ex: [] })

// Keep only the fields that define the movement — the same subset plan-share's cleanEx keeps,
// minus `sets` and the progression rule, which a circuit has no use for.
export function cleanCircuitEx(e) {
  const o = { id: e.id }
  const mode = modeOf(e)
  if (mode === 'time') { o.mode = 'time'; if (e.sec != null) o.sec = e.sec; if (e.weight) o.weight = e.weight }
  else if (mode === 'cardio') { if (e.min != null) o.min = e.min; if (e.speed != null) o.speed = e.speed }
  else { if (e.reps != null) o.reps = e.reps; if (e.weight) o.weight = e.weight }
  if (e.bodyweight != null) o.bodyweight = e.bodyweight
  if (e.side) o.side = true
  return o
}

// Snapshot an existing routine group (indices `members`, sharing `sg`) as a saved circuit.
export function groupToCircuit(routine, sg, members, label) {
  const cg = routine.cg && routine.cg[sg]
  return {
    id: 'c' + uid(),
    label: label || (cg && cg.label) || '',
    rounds: Math.max(1, (cg && cg.rounds) || routine.ex[members[0]]?.sets || 3),
    ex: members.map(m => cleanCircuitEx(routine.ex[m]))
  }
}

// Build the routine-entry list for a saved circuit under one shared `sg`. `rounds` becomes
// each entry's `sets` so the existing one-line summary and the workout builder stay honest.
function entriesFor(saved, sg) {
  return saved.ex.map(e => ({ ...e, sg, sets: saved.rounds }))
}

/**
 * Replace the group `sg` in a routine with a saved circuit, in place. Members keep their
 * slot range; `cg[sg]` is rewritten with the new rounds/label and the circuit's id.
 */
export function applyCircuitToRoutine(routine, sg, saved) {
  const idx = routine.ex.map((e, i) => (e.sg === sg ? i : -1)).filter(i => i >= 0)
  if (!idx.length) return
  const at = idx[0]
  routine.ex.splice(at, idx.length, ...entriesFor(saved, sg))
  routine.cg = routine.cg || {}
  routine.cg[sg] = { rounds: saved.rounds, label: saved.label, cid: saved.id }
}

/** Append a saved circuit to a routine as a fresh group. */
export function appendCircuitToRoutine(routine, saved) {
  const sg = 'sg' + uid()
  routine.ex.push(...entriesFor(saved, sg))
  routine.cg = routine.cg || {}
  routine.cg[sg] = { rounds: saved.rounds, label: saved.label, cid: saved.id }
}

/**
 * Every logged run of the circuits in `S.circuits`, newest first. A run is one workout's
 * worth of a group whose `cg` entry carried a matching `cid` (falls back to matching the
 * label when a run predates cids). `{ cid, label, date, rounds, members:[{id,sets}], reps, sec }`.
 */
export function circuitRuns(S) {
  const byId = new Map((S.circuits || []).map(c => [c.id, c]))
  const byLabel = new Map((S.circuits || []).filter(c => c.label).map(c => [c.label.toLowerCase(), c]))
  const runs = []
  ;(S.workouts || []).forEach(w => {
    const cg = w.cg
    if (!cg) return
    Object.keys(cg).forEach(sg => {
      const meta = cg[sg]
      const saved = (meta.cid && byId.get(meta.cid)) || (meta.label && byLabel.get(meta.label.toLowerCase()))
      if (!saved) return
      const members = (w.entries || []).filter(e => e.sg === sg && e.sets.some(s => s.done))
      if (!members.length) return
      let reps = 0; let sec = 0
      members.forEach(e => e.sets.forEach(s => { if (s.done) { reps += s.r || 0; sec += s.sec || 0 } }))
      const rounds = Math.min(...members.map(e => e.sets.filter(s => s.done).length))
      runs.push({
        cid: saved.id, label: saved.label || meta.label || '', date: w.d,
        rounds, reps, sec,
        members: members.map(e => ({ id: e.id, sets: e.sets.filter(s => s.done).length }))
      })
    })
  })
  return runs.reverse()
}
