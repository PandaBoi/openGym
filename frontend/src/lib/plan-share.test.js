import { describe, it, expect } from 'vitest'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'
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
