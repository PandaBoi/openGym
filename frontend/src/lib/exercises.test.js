import { describe, it, expect } from 'vitest'
import { allExercises, normCustom, EXDB } from './exercises.js'
import { mergePlan } from './plan-share.js'

// Regression: a custom exercise with no `tg`/`eq` (as a plan import used to create) crashed
// the exercise picker's search — `e.tg.includes(q)` on undefined took the whole view down.
describe('custom exercise normalisation', () => {
  it('normCustom backfills the string fields search relies on', () => {
    const n = normCustom({ id: 'c1', n: 'Depth jump', bp: 'thighs' })
    expect(n.tg).toBe('')
    expect(n.eq).toBe('custom')
    expect(n.custom).toBe(true)
  })

  it('allExercises never yields a custom missing tg/eq', () => {
    const st = { customEx: [{ id: 'c1', n: 'Triple extension', bp: 'thighs' }] }
    for (const e of allExercises(st)) {
      expect(typeof e.tg).toBe('string')
      expect(typeof e.eq).toBe('string')
    }
  })

  it("the picker's search filter survives a fields-less custom", () => {
    const st = { customEx: [{ id: 'c1', n: 'Katana extension', bp: 'upper arms' }] }
    const all = allExercises(st)
    const ql = 'kat'
    // mirrors sheets.jsx ExercisePicker
    const hit = () => all.filter(e =>
      (!ql || (e.n || '').toLowerCase().includes(ql) || (e.tg || '').includes(ql) || (e.eq || '').includes(ql) || (e.desc || '').toLowerCase().includes(ql)))
    expect(hit).not.toThrow()
    expect(hit().some(e => e.id === 'c1')).toBe(true)
  })

  it('mergePlan writes customs that are already normalised', () => {
    const A = EXDB.find(e => e.bp !== 'cardio').id
    const s = { routines: [], circuits: [], customEx: [] }
    const bundle = {
      routines: [{ id: 'r1', name: 'P', emoji: 'x', ts: 1, ex: [{ id: 'x1', sets: 3, reps: 8 }] }],
      circuits: [], customEx: [{ id: 'x1', n: 'Triple extension', bp: 'thighs' }]
    }
    mergePlan(s, bundle, {})
    expect(s.customEx).toHaveLength(1)
    expect(s.customEx[0].tg).toBe('')
    expect(s.customEx[0].eq).toBe('custom')
  })
})
