// Build a shareable openGym plan file (see src/lib/plan-share.js) for "Phase 2" — the W5
// screenshots the user supplied: a 5-day split (Full Body High / Upper Low A + Low Mobility /
// Lower High + Sprints High / Upper Low B / Full Body Low) plus two optional stacked
// conditioning/mobility days. This is NOT a backup — it carries only routines + customEx +
// week + circuits, and importing it on the phone (Plan -> Share -> Import) MERGES by routine
// name by `ts`, so it never touches history, settings or other routines.
//
//   node --import ./scripts/_vite-glob-shim.mjs scripts/gen-phase2-plan.mjs --out <file.json>
//
// Not carried over (no openGym field, same limitation as gen-plan-backup.mjs): tempo/pause
// cues, exact multi-phase set schemes (e.g. "2 paused sets + 1 unpaused set" collapses to one
// rep range), EMOM/interval work:rest structure (kept as the work interval only), and
// week-conditional progressions. These are approximated as closely as the data model allows.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { matchExercise } from '../src/lib/import-csv.js'
import { EXIDX } from '../src/lib/exercises.js'
import { uid } from '../src/lib/format.js'

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith('--')) {
    const key = a.slice(2)
    const val = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true'
    args[key] = val
  }
}
const expand = p => p && p.replace(/^~/, os.homedir()).trim()
const OUT = expand(args.out) || './phase2-plan.json'

/* --------------------------------------------------------------- customs ---- */
const customEx = []
const customByKey = {}
const mkCustom = (n, bp, desc) => {
  const key = n.toLowerCase() + '|' + bp
  if (customByKey[key]) return customByKey[key]
  const id = 'c' + uid() + Math.random().toString(36).slice(2, 6)
  customEx.push({ id, n: n.toLowerCase(), bp, ...(desc ? { desc } : {}) })
  customByKey[key] = id
  return id
}
const rid = ({ lib, custom }) => {
  if (lib && EXIDX[lib]) return lib
  if (custom) return mkCustom(custom[0], custom[1], custom[2])
  throw new Error('cannot resolve ' + JSON.stringify({ lib, custom }))
}

let sgN = 0
const SG = () => 'sg' + uid() + (++sgN)
// "HB4" = Hybrid Bodybuilding (the program name), P2 = this phase — prefixed so the routine
// list reads unambiguously next to any other plan's routines of the same generic name.
const PREFIX = 'HB4P2 '
const R = (name, emoji, ex, extra = {}) => ({ id: uid() + Math.random().toString(36).slice(2, 5), name: PREFIX + name, emoji, ts: Date.now(), ex, ...extra })

// reps-mode entry. `f.x` for extra flags (side, bodyweight, prog, sg, repsMin, warmups…).
const reps = (o, sets, r, f = {}) => ({ id: rid(o), sets, reps: r, mode: 'reps', weight: f.weight || 0, ...(f.repsMin ? { repsMin: f.repsMin } : {}), ...f.x })
// time-mode entry (a held/worked duration). `f.x` as above.
const time = (o, sets, sec, f = {}) => ({ id: rid(o), sets, sec, mode: 'time', weight: f.weight || 0, ...f.x })

const off = (extra = {}) => ({ prog: 'off', ...extra })
const bw = (extra = {}) => ({ bodyweight: true, ...extra })
const side = (extra = {}) => ({ side: true, ...extra })

/* ======================================================= Day 1 — Full Body High ==== */
const wu1 = SG(), cc1 = SG(), fin1 = SG()
const fullBodyHigh = R('Full Body High', 'legs', [
  reps({ custom: ['Hip Airplane', 'upper legs', 'Warm-up. Perform with minimal rest between A1-A4.'] }, 1, 20, { x: { ...side(bw(off())), sg: wu1 } }),
  reps({ custom: ['Double Elephant', 'upper legs'] }, 1, 20, { x: { ...side(bw(off())), sg: wu1 } }),
  time({ custom: ['Wall Reference Lunge', 'upper legs'] }, 1, 30, { x: { ...side(bw(off())), sg: wu1 } }),
  reps({ custom: ['Cossack Switches', 'upper legs', 'Hold a support in front of you for assistance as required.'] }, 1, 10, { x: { ...side(bw(off())), sg: wu1 } }),
  reps({ custom: ['Triple Extension B-Stance Trap Bar Deadlift', 'upper legs', "Don't load heavy — train the skill of triple extension (stand on tip toes, knees locked, hips extended) with a 1-2s hold at lockout. Sub DB/KBs by your side, at rack, or goblet if no trap bar."] }, 3, 5, { x: { ...side(off()) } }),
  reps({ lib: '0127' }, 3, 5, { repsMin: 3, x: { sg: cc1, weight: 0 } }),
  reps({ custom: ['Vertical Jump — Test & Reps', 'upper legs', 'Stop once you lose explosiveness in your reps.'] }, 3, 4, { x: { ...bw(off()), sg: cc1 } }),
  reps({ lib: '2330' }, 2, 8, { repsMin: 6, x: { side: true } }),
  reps({ lib: '0251' }, 5, 6, { repsMin: 4, x: { ...bw({}) } }),
  time({ custom: ['Reverse Plank to Lateral Shift / Side Plank', 'waist'] }, 2, 45, { x: { ...bw(off()), sg: fin1 } }),
  time({ custom: ['Plank Up Downs', 'waist'] }, 2, 45, { x: { ...bw(off()), sg: fin1 } }),
])
fullBodyHigh.cg = { [cc1]: { rounds: 3, label: 'Zercher + Jump' } }

/* ======================================================= Low Day Mobility ==== */
const lowMobility = R('Low Mobility', 'stretch', [
  time({ custom: ['Dead Hang', 'back', 'Use feet on the ground for assistance as required.'] }, 2, 45, { x: { ...bw(off()) } }),
  reps({ custom: ['Hamstring Kicks', 'upper legs'] }, 1, 30, { x: { ...side(bw(off())) } }),
  reps({ custom: ['Double Elephant', 'upper legs'] }, 1, 30, { x: { ...bw(off()) } }),
  time({ custom: ['Active Front Split', 'upper legs', 'Add weight if required.'] }, 2, 30, { x: { ...side(bw(off())) } }),
  time({ custom: ['Hip Flexor Lunge Stretch', 'upper legs'] }, 1, 60, { x: { ...side(bw(off())) } }),
  time({ custom: ['Passive Front Split', 'upper legs'] }, 1, 60, { x: { ...side(bw(off())) } }),
  reps({ custom: ['Reverse Nordic', 'upper legs', 'Use band assistance, weight or a reduced range as required.'] }, 2, 12, { repsMin: 10, x: { ...bw({}) } }),
])

/* ======================================================= Sprints High ==== */
const sprintsHigh = R('Sprints High', 'figureRun', [
  reps({ custom: ['Forwards Pogo Hops', 'lower legs'] }, 1, 20, { x: { ...bw(off()) } }),
  reps({ custom: ['Low Ceiling Deep Leap', 'upper legs'] }, 2, 5, { x: { ...bw(off()) } }),
  reps({ custom: ['Forwards Hops', 'upper legs'] }, 2, 10, { x: { ...side(bw(off())) } }),
  reps({ custom: ['Skip for Height', 'upper legs'] }, 2, 10, { x: { ...side(bw(off())) } }),
  reps({ custom: ['Hamstring Kicks', 'upper legs'] }, 1, 20, { x: { ...side(bw(off())) } }),
  time({ custom: ['Hill Sprint', 'cardio', '3-minute light jog to warm up. 10 sets of 15s on @ 70-80% intensity / 45s walk. As high an incline as you can manage.'] }, 10, 15, { x: { ...bw(off()) } }),
])

/* ======================================================= Upper Low A (D2) ==== */
const b2 = SG(), d2 = SG()
const upperLowA = R('Upper Low A', 'dumbbell', [
  reps({ custom: ['Incline Trap 3 Raise', 'back', 'Warm-up — 1-2 light sets, minimal rest.'] }, 2, 10, { x: { ...off() } }),
  reps({ lib: '0688' }, 2, 20, { x: { ...bw(off()) } }),
  time({ custom: ['Row Isometronic', 'back', 'Gradually ramp up intensity so you are pulling with max effort on the last 4-6 seconds.'] }, 2, 10, { x: { ...off() } }),
  reps({ lib: '0861' }, 3, 8, { repsMin: 6, x: { sg: b2 } }),
  reps({ custom: ['Kelso Shrug', 'back'] }, 2, 15, { x: { sg: b2 } }),
  reps({ lib: '0314' }, 2, 8, { repsMin: 6, x: {} }),
  reps({ custom: ['Butterfly Laterals', 'shoulders'] }, 2, 13, { repsMin: 10, x: { sg: d2 } }),
  time({ custom: ['Dumbbell Y Raise', 'back', 'Same weight as Butterfly Laterals. Hold the top of the Y raise for max time — 10s good, 30s great, 60s elite.'] }, 2, 20, { x: { sg: d2 } }),
])

/* ======================================================= Lower High (D3) ==== */
const lowerHigh = R('Lower High', 'kettlebell', [
  reps({ custom: ['Snatch Grip Deadlift', 'upper legs', "Don't expect top weights — fatigued from sprints/plyos."] }, 2, 4, { repsMin: 3, x: {} }),
  time({ custom: ['Hollow Lifts', 'waist', 'One set between every deadlift warm-up set. If doing minimal warm-ups, do at least 3 sets.'] }, 3, 15, { x: { ...bw(off()) } }),
  reps({ lib: '1460' }, 2, 13, { repsMin: 10, x: { side: true } }),
  reps({ lib: '0586' }, 2, 13, { repsMin: 10, x: {} }),
])

/* ======================================================= Upper Low B (D4) ==== */
const c4 = SG()
const upperLowB = R('Upper Low B', 'pullup', [
  reps({ custom: ['Windmill', 'waist', 'Gently reach for more range on each rep.'] }, 2, 6, { x: { ...side(bw(off())) } }),
  reps({ custom: ['Seated Twist', 'waist'] }, 2, 10, { x: { ...side(bw(off())) } }),
  reps({ lib: '0472' }, 2, 18, { repsMin: 15, x: { ...bw({}) } }),
  time({ lib: '3296' }, 3, 13, { x: { ...bw({}) } }),
  reps({ lib: '1326' }, 4, 8, { repsMin: 6, x: { ...bw({}) } }),
  reps({ lib: '0031' }, 2, 8, { repsMin: 6, x: {} }),
  reps({ lib: '0241' }, 2, 8, { repsMin: 6, x: {} }),
  reps({ lib: '0549' }, 10, 30, { x: { weight: 0 } }),
])

/* ======================================================= Full Body Low (D5) ==== */
const b5 = SG(), c5 = SG()
const fullBodyLow = R('Full Body Low', 'legs', [
  time({ custom: ['Norwegian 4x4', 'cardio', 'VO2 max conditioning: 3-minute warm-up, then 4 rounds of 4 minutes on @ 70-80% intensity / 3 minutes easy recovery. Ideally on a bike.'] }, 4, 240, { x: { ...bw(off()) } }),
  time({ custom: ['Prone Arch to Hollow', 'waist'] }, 3, 15, { x: { ...bw(off()), sg: b5 } }),
  time({ custom: ['Arch Lifts & Arch Position', 'waist'] }, 3, 15, { x: { ...bw(off()), sg: b5 } }),
  reps({ custom: ['QL Walk', 'waist'] }, 3, 20, { x: { ...bw(off()), sg: b5 } }),
  reps({ lib: '1700' }, 3, 8, { repsMin: 6, x: { side: true, sg: c5 } }),
  reps({ lib: '0499' }, 3, 8, { repsMin: 6, x: { ...side(bw({})), sg: c5 } }),
  reps({ custom: ['Dual Elevated Hip Thrust', 'upper legs'] }, 2, 18, { repsMin: 15, x: { side: true } }),
])

/* ------------------------------------------------------------- assemble ---- */
// Two of the days are two workouts meant for the same session, not two separate training
// days — merged into one routine each, exercises in the order you'd actually do them, so a
// single "Start workout" covers the whole day. D2: Upper Low A then Low Mobility (source says
// either order is fine). D3: Sprints High *before* Lower High (source: "ideally perform it
// before the lower lifting session" — the neural-fatigue stacking only works in that
// direction, so this one's order is load-bearing, not arbitrary).
const merge = (name, emoji, ...days) => ({
  id: uid() + Math.random().toString(36).slice(2, 5), name: PREFIX + name, emoji, ts: Date.now(),
  ex: days.flatMap(d => d.ex),
  ...(days.some(d => d.cg) ? { cg: Object.assign({}, ...days.map(d => d.cg || {})) } : {}),
})
const day2 = merge('Upper Low A + Mobility', upperLowA.emoji, upperLowA, lowMobility)
const day3 = merge('Sprints + Lower High', sprintsHigh.emoji, sprintsHigh, lowerHigh)

const routines = [fullBodyHigh, day2, day3, upperLowB, fullBodyLow]
// Wednesday is a rest day — the rest of the week shifts down a day to make room for it,
// sequence unchanged. getDay(): Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6.
const week = { 1: fullBodyHigh.id, 2: day2.id, 4: day3.id, 5: upperLowB.id, 6: fullBodyLow.id }

const bad = []
for (const r of routines) for (const e of r.ex)
  if (!EXIDX[e.id] && !customEx.some(c => c.id === e.id)) bad.push(e.id)
if (bad.length) { console.error('unresolved exercise ids:', bad); process.exit(1) }

const bundle = { opengym_plan: 1, exported: new Date().toISOString().slice(0, 10), name: 'HB4P2 — Week 5', week, routines, customEx, circuits: [] }
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(bundle, null, 2))
console.log(`routines=${routines.length}  customs=${customEx.length}  ->  ${OUT}`)
for (const r of routines) {
  const line = r.ex.map(e => {
    const ex = EXIDX[e.id] || customEx.find(c => c.id === e.id)
    return (ex.bp && !EXIDX[e.id] ? '*' : '') + ex.n
  }).join(', ')
  console.log(`  ${r.name}: ${line}`)
}
