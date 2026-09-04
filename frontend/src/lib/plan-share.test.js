import { describe, it, expect } from 'vitest'
import { buildPlanBundle, parsePlan, mergePlan, planConflicts } from './plan-share.js'
import { EXDB } from './exercises.js'

const A = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const B = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight' && e.id !== A).id

const baseState = () => ({
  unit: 'kg',
  routines: [
    { id: 'r1', name: 'Push', emoji: 'x', ex: [{ id: A, sets: 3, reps: 8, weight: 40 }] },
    { id: 'r2', name: 'Pull', emoji: 'y', ex: [{ id: B, sets: 3, reps: 8, weight: 30, sg: 'g' }, { id: A, sets: 3, reps: 8, sg: 'g' }], cg: { g: { rounds: 3, label: 'Row circuit', cid: 'cA' } } }
  ],
  circuits: [
    { id: 'cA', label: 'Row circuit', rounds: 3, ex: [{ id: B }, { id: A }] },
    { id: 'cB', label: 'Standalone', rounds: 4, ex: [{ id: A }] }
  ],
  week: { 1: 'r1', 3: 'r2' },
  customEx: []
})

describe('buildPlanBundle — selective export', () => {
  it('exports only the chosen routines and their week days', () => {
    const b = buildPlanBundle(baseState(), 'x', { routineIds: ['r1'] })
    expect(b.routines.map(r => r.id)).toEqual(['r1'])
    expect(b.week).toEqual({ 1: 'r1' })            // r2's day dropped
  })

  it('drops the week entirely when week:false', () => {
    const b = buildPlanBundle(baseState(), 'x', { week: false })
    expect(b.week).toEqual({})
  })

  it('circuits:false still carries circuits a chosen routine references', () => {
    const b = buildPlanBundle(baseState(), 'x', { circuits: false })
    expect(b.circuits.map(c => c.id).sort()).toEqual(['cA'])   // cB (unreferenced) left out
  })

  it('circuits default carries the whole library', () => {
    const b = buildPlanBundle(baseState(), 'x')
    expect(b.circuits.map(c => c.id).sort()).toEqual(['cA', 'cB'])
  })
})

describe('mergePlan — selective import', () => {
  const roundTrip = (pick, mergeOpts) => {
    const bundle = parsePlan(JSON.stringify(buildPlanBundle(baseState(), 'x', pick)))
    const s = { routines: [], circuits: [], customEx: [], week: {} }
    const res = mergePlan(s, bundle, mergeOpts)
    return { s, res }
  }

  it('merges only the allow-listed routines', () => {
    const { s, res } = roundTrip({}, { routineIds: ['r1'] })
    expect(s.routines.map(r => r.name)).toEqual(['Push'])
    expect(res.routines).toBe(1)
  })

  it('skips the saved-circuit library when circuits:false, keeping referenced ones', () => {
    const { s } = roundTrip({}, { circuits: false })
    // only "Row circuit" (referenced by Pull's cg) comes in, not "Standalone"
    expect(s.circuits.map(c => c.label).sort()).toEqual(['Row circuit'])
  })

  it('remaps the cid on a merged routine to the freshly added circuit', () => {
    const { s } = roundTrip({}, {})
    const pull = s.routines.find(r => r.name === 'Pull')
    const g = Object.values(pull.cg)[0]
    expect(g.cid).toBeTruthy()
    expect(s.circuits.some(c => c.id === g.cid)).toBe(true)
  })
})

describe('name-conflict resolution — never duplicate, resolve by timestamp', () => {
  const incoming = ts => ({
    opengym_plan: 1, name: 'x', week: {}, customEx: [], circuits: [],
    routines: [{ id: 'rX', name: 'Push', ts, ex: [{ id: A, sets: 5, reps: 5 }] }]
  })
  const localWithPush = ts => ({ routines: [{ id: 'local1', name: 'Push', ts, ex: [{ id: A, sets: 3, reps: 8 }] }], circuits: [], customEx: [], week: {} })

  it('planConflicts reports overwrite when the file is newer', () => {
    const c = planConflicts(localWithPush(1000), parsePlan(JSON.stringify(incoming(2000))))
    expect(c).toEqual([{ name: 'Push', overwrite: true, incomingTs: 2000, localTs: 1000 }])
  })

  it('planConflicts reports keep when the local copy is as new or newer', () => {
    expect(planConflicts(localWithPush(2000), parsePlan(JSON.stringify(incoming(1000))))[0].overwrite).toBe(false)
    expect(planConflicts(localWithPush(1000), parsePlan(JSON.stringify(incoming(1000))))[0].overwrite).toBe(false)
  })

  it('mergePlan overwrites in place (same id) when the file is newer — no duplicate', () => {
    const s = localWithPush(1000)
    const bundle = parsePlan(JSON.stringify(incoming(2000)))
    const res = mergePlan(s, bundle, {})
    expect(s.routines).toHaveLength(1)
    expect(s.routines[0].id).toBe('local1')          // id preserved — week/day-overrides still resolve
    expect(s.routines[0].ex[0].sets).toBe(5)          // content replaced with the file's version
    expect(res).toMatchObject({ routines: 1, added: 0, overwritten: 1, skipped: 0 })
  })

  it('mergePlan keeps the local copy and skips when it is as new or newer — no duplicate', () => {
    const s = localWithPush(2000)
    const bundle = parsePlan(JSON.stringify(incoming(1000)))
    const res = mergePlan(s, bundle, {})
    expect(s.routines).toHaveLength(1)
    expect(s.routines[0].ex[0].sets).toBe(3)          // untouched
    expect(res).toMatchObject({ routines: 0, added: 0, overwritten: 0, skipped: 1 })
  })

  it('a routine with no matching name is always just added', () => {
    const s = { routines: [{ id: 'local1', name: 'Pull', ts: 9999, ex: [] }], circuits: [], customEx: [], week: {} }
    const bundle = parsePlan(JSON.stringify(incoming(1)))
    const res = mergePlan(s, bundle, {})
    expect(s.routines.map(r => r.name).sort()).toEqual(['Pull', 'Push'])
    expect(res.added).toBe(1)
  })
})
