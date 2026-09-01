// Build an openGym backup JSON = a person's FitNotes history (merged) + the 8-week
// "Wedding Prep" plan as 4 routines wired to Mon/Tue/Thu/Fri.
//
//   node --import ./scripts/_vite-glob-shim.mjs scripts/gen-plan-backup.mjs \
//        --csv ~/Documents/Misc/FitNotes_Export.csv \
//        --out ~/Documents/openGym-personal/rohan-backup.json \
//        --body male
//
// Import the result on a fresh app via Settings -> Import backup (it replaces state,
// so it goes first). Re-importing a FitNotes CSV afterwards still merges.
//
// The plan itself: ~/Documents/Misc/Wedding_8_Week_Plan-1.xlsx
// Not carried over (no openGym field): tempo, warm-ups, mobility flows, finishers.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseImport, mergeImport, matchExercise } from '../src/lib/import-csv.js'
import { EXIDX } from '../src/lib/exercises.js'
import { uid } from '../src/lib/format.js'

/* -------------------------------------------------------------- args ---- */
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
const CSV = expand(args.csv)
const OUT = expand(args.out) || './backup.json'
const BODY = args.body === 'female' ? 'female' : 'male'
if (!CSV || !fs.existsSync(CSV)) { console.error('need --csv <FitNotes export.csv>'); process.exit(1) }

/* -------------------------------------------------------------- base ---- */
const DEF = {
  unit: 'kg', restSec: 90, sound: true, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: BODY, targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  reminder: { on: false, time: '08:00', tz: null }, effort: 'rpe',
}
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const parsed = parseImport(fs.readFileSync(CSV, 'utf8'), { unit: 'kg' })
if (parsed.error || parsed.kind !== 'workouts') { console.error('unrecognised CSV:', parsed.error || parsed.kind); process.exit(1) }
const S = JSON.parse(JSON.stringify(DEF))
mergeImport(S, parsed)

const customByName = {}
for (const c of S.customEx) customByName[norm(c.n)] = c.id
// id this movement's imported history now lives under (matched library, or a custom), else null
const histId = names => {
  for (const n of [].concat(names)) {
    const id = matchExercise(n) || customByName[norm(n)]
    if (id) return id
  }
  return null
}
const mkCustom = (n, bp) => {
  const k = norm(n)
  if (customByName[k]) return customByName[k]
  const id = 'c' + uid() + Math.random().toString(36).slice(2, 6)
  S.customEx.push({ id, n: n.toLowerCase(), bp, tg: '', eq: 'custom', desc: '', custom: true })
  customByName[k] = id
  return id
}
let sgN = 0
const SG = () => 'sg' + uid() + (++sgN)
const R = (name, emoji, prog, ex) => ({ id: uid() + Math.random().toString(36).slice(2, 5), name, emoji, prog, ex })

// resolve an exercise id: history continuity first, then a clean library id, then a fresh custom
const rid = ({ hist, lib, custom }) => {
  if (hist) { const h = histId(hist); if (h) return h }
  if (lib && EXIDX[lib]) return lib
  if (custom) return mkCustom(custom[0], custom[1])
  throw new Error('cannot resolve ' + JSON.stringify({ hist, lib, custom }))
}
const reps = (o, sets, top, bottom, f = {}) => ({ id: rid(o), sets, reps: top, ...(bottom ? { repsMin: bottom } : {}), weight: f.weight || 0, mode: 'reps', ...f.x })
const time = (o, sets, sec, f = {}) => ({ id: rid(o), sets, sec, weight: 0, mode: 'time', ...f.x })

/* ------------------------------------------------------- the 4 routines ---- */
// hist = candidate FitNotes names (any person's dialect); first that resolves wins.
const b1 = SG(), c1 = SG(), d1 = SG()
const day1 = R('Day 1 · Lower A', 'legs', 'double', [
  reps({ hist: ['Box Jump', 'BOX Jump'], custom: ['Box Jump', 'upper legs'] }, 2, 5, 0, { x: { bodyweight: true, prog: 'off' } }),
  reps({ hist: ['Barbell Front Squat'], lib: '0042' }, 2, 10, 6),
  reps({ hist: ['Romanian Deadlift', 'Stiff-Legged Deadlift'], lib: '0085' }, 2, 10, 8, { x: { sg: b1 } }),
  reps({ hist: ['Pallof Press', 'Pallof Raise'], lib: '0979' }, 2, 10, 0, { x: { side: true, sg: b1, prog: 'off' } }),
  reps({ hist: ['Bulgarian Split Squat', 'Front Elevated Bulgarian Split'], custom: ['Bulgarian Split Squat', 'upper legs'] }, 2, 10, 8, { x: { side: true, sg: c1 } }),
  time({ custom: ['Zercher Carry', 'waist'] }, 2, 30, { x: { sg: c1, prog: 'off' } }),
  reps({ hist: ['Seated Leg Curl Machine', 'Lying Leg Curl Machine'], lib: '0599' }, 2, 15, 10, { x: { sg: d1 } }),
  time({ hist: ['Copenhagen Plank'], custom: ['Copenhagen Plank', 'upper legs'] }, 2, 25, { x: { side: true, sg: d1, prog: 'off' } }),
])
const b2 = SG(), c2 = SG(), d2 = SG()
const day2 = R('Day 2 · Upper Push', 'dumbbell', 'double', [
  reps({ hist: ['Flat Barbell Bench Press', 'Barbell Bench Press'], lib: '0025' }, 2, 10, 6),
  reps({ hist: ['Landmine Press'], custom: ['Single-Arm Landmine Press', 'shoulders'] }, 2, 10, 8, { x: { side: true, sg: b2 } }),
  reps({ hist: ['Chest Supported Dumbbell Row', 'Dumbbell Row'], lib: '0327' }, 2, 12, 10, { x: { sg: b2 } }),
  reps({ hist: ['Pull Up', 'Pull-Up'], lib: '0652' }, 2, 10, 8, { x: { bodyweight: true, sg: c2 } }),
  reps({ hist: ['Parallel Bar Triceps Dip', 'Ring Dip'], lib: '1767' }, 2, 12, 8, { x: { bodyweight: true, sg: c2 } }),
  reps({ hist: ['Lateral Dumbbell Raise', 'Lateral Machine Raise'], lib: '0334' }, 2, 15, 12, { x: { sg: d2 } }),
  reps({ hist: ['Cable Face Pull'], custom: ['Cable Face Pull', 'shoulders'] }, 2, 20, 15, { x: { sg: d2 } }),
  reps({ hist: ['Seated Incline Dumbbell Curl', 'Incline Dumbbell Curl'], lib: '0318' }, 2, 12, 10, { x: { sg: d2 } }),
])
const b3 = SG(), c3 = SG(), d3 = SG()
const day3 = R('Day 3 · Lower B', 'kettlebell', 'double', [
  reps({ custom: ['Lateral Skater Bound', 'upper legs'] }, 2, 5, 0, { x: { side: true, bodyweight: true, prog: 'off' } }),
  reps({ hist: ['Trap Bar Deadlift', 'Deadlift'], lib: '0811' }, 2, 8, 5),
  reps({ hist: ['Kb Swing', 'Kettlebell Swings'], lib: '0549' }, 2, 15, 12, { x: { sg: b3 } }),
  reps({ hist: ['Lateral Lunge', 'Side Lunge'], custom: ['Dumbbell Lateral Lunge', 'upper legs'] }, 2, 10, 8, { x: { side: true, sg: b3 } }),
  reps({ hist: ['Cossack Squat'], custom: ['Cossack Squat', 'upper legs'] }, 2, 8, 0, { x: { side: true, sg: c3 } }),
  time({ hist: ['Suitcase Carry', 'Farmers Carry', 'Farmer Carry'], custom: ['Suitcase Carry', 'waist'] }, 2, 30, { x: { side: true, sg: c3, prog: 'off' } }),
  reps({ hist: ['Single Leg Romanian Deadlift'], lib: '1757' }, 2, 10, 0, { x: { side: true, sg: d3 } }),
  reps({ hist: ['Pallof Press', 'Pallof Raise'], lib: '0979' }, 2, 10, 0, { x: { side: true, sg: d3, prog: 'off' } }),
])
const b4 = SG(), c4 = SG(), d4 = SG()
const day4 = R('Day 4 · Upper Pull', 'pullup', 'double', [
  reps({ hist: ['Pull Up', 'Pull-Up'], lib: '0652' }, 2, 8, 5, { weight: 5, x: { bodyweight: true } }),
  reps({ hist: ['Pendlay Row', 'Barbell Row'], lib: '3017' }, 2, 10, 8, { x: { sg: b4 } }),
  reps({ hist: ['Incline Dumbbell Bench Press', 'Incline Dumbbell Press'], lib: '0314' }, 2, 12, 10, { x: { sg: b4 } }),
  reps({ hist: ['Single Arm Db Row', 'Dumbbell Row', 'Meadow Rows'], lib: '0292' }, 2, 12, 10, { x: { side: true, sg: c4 } }),
  reps({ hist: ['Lat Pulldown', 'Neutral Grip Lat Pull down'], lib: '2330' }, 2, 12, 10, { x: { sg: c4 } }),
  reps({ hist: ['Cable Face Pull'], custom: ['Cable Face Pull', 'shoulders'] }, 2, 20, 15, { x: { sg: d4 } }),
  reps({ hist: ['Barbell Curl', 'Ez-Bar Curl', 'Cable Curl'], lib: '0031' }, 2, 12, 10, { x: { sg: d4 } }),
])

S.routines = [day1, day2, day3, day4]
S.week = { 1: day1.id, 2: day2.id, 4: day3.id, 5: day4.id }  // getDay(): Mon=1 Tue=2 Thu=4 Fri=5

/* ------------------------------------------------------------- verify ---- */
const bad = []
for (const r of S.routines) for (const e of r.ex)
  if (!EXIDX[e.id] && !S.customEx.some(c => c.id === e.id)) bad.push(e.id)
if (bad.length) { console.error('unresolved exercise ids:', bad); process.exit(1) }

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(S))
console.log(`body=${BODY}  workouts=${S.workouts.length}  customs=${S.customEx.length}  ->  ${OUT}`)
for (const r of S.routines) {
  const line = r.ex.map(e => {
    const ex = EXIDX[e.id] || S.customEx.find(c => c.id === e.id)
    return (ex.eq === 'custom' ? '*' : '') + ex.n
  }).join(', ')
  console.log(`  ${r.name}: ${line}`)
}
