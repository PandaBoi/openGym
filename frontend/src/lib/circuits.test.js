import { describe, it, expect } from 'vitest'
import { newCircuit, groupToCircuit, applyCircuitToRoutine, appendCircuitToRoutine, circuitRuns } from './circuits.js'
import { EXDB } from './exercises.js'

const A = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight').id
const B = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight' && e.id !== A).id
const C = EXDB.find(e => e.bp !== 'cardio' && e.eq !== 'body weight' && e.id !== A && e.id !== B).id

describe('newCircuit', () => {
  it('makes an empty 3-round circuit with a c-prefixed id', () => {
    const c = newCircuit('Core')
    expect(c.label).toBe('Core')
    expect(c.rounds).toBe(3)
    expect(c.ex).toEqual([])
    expect(c.id.startsWith('c')).toBe(true)
  })
})

describe('groupToCircuit', () => {
  it('snapshots a routine group, taking rounds from the cg entry', () => {
    const r = { ex: [{ id: A, sg: 'g', sets: 4, reps: 12 }, { id: B, sg: 'g', sets: 4, reps: 10 }], cg: { g: { rounds: 4, label: 'Finisher' } } }
    const c = groupToCircuit(r, 'g', [0, 1])
    expect(c.rounds).toBe(4)
    expect(c.label).toBe('Finisher')
    expect(c.ex.map(e => e.id)).toEqual([A, B])
    expect(c.ex[0].sets).toBeUndefined()   // rounds live on the circuit, not the ex
  })
})

describe('applyCircuitToRoutine', () => {
  it('replaces the group in place and rewrites cg with the circuit id', () => {
    const r = { ex: [{ id: A }, { id: B, sg: 'g' }, { id: C, sg: 'g' }], cg: { g: { rounds: 3, label: 'old' } } }
    const saved = { id: 'cX', label: 'new', rounds: 5, ex: [{ id: C, reps: 8 }, { id: A, reps: 8 }] }
    applyCircuitToRoutine(r, 'g', saved)
    expect(r.ex.map(e => e.id)).toEqual([A, C, A])
    expect(r.ex.slice(1).every(e => e.sg === 'g' && e.sets === 5)).toBe(true)
    expect(r.cg.g).toEqual({ rounds: 5, label: 'new', cid: 'cX' })
  })
})

describe('appendCircuitToRoutine', () => {
  it('adds the circuit as a fresh group at the end', () => {
    const r = { ex: [{ id: A }], cg: {} }
    appendCircuitToRoutine(r, { id: 'cY', label: 'burn', rounds: 4, ex: [{ id: B }, { id: C }] })
    expect(r.ex).toHaveLength(3)
    const sg = r.ex[1].sg
    expect(sg).toBeTruthy()
    expect(r.ex[2].sg).toBe(sg)
    expect(r.cg[sg]).toEqual({ rounds: 4, label: 'burn', cid: 'cY' })
  })
})

describe('circuitRuns', () => {
  const S = {
    circuits: [{ id: 'c1', label: 'Core', rounds: 3, ex: [{ id: A }, { id: B }] }],
    workouts: [
      { d: '2026-02-01', cg: { g: { rounds: 3, label: 'Core', cid: 'c1' } }, entries: [
        { id: A, sg: 'g', sets: [{ r: 12, done: true }, { r: 12, done: true }, { r: 10, done: true }] },
        { id: B, sg: 'g', sets: [{ r: 15, done: true }, { r: 15, done: true }, { r: 12, done: true }] }
      ] },
      { d: '2026-02-08', cg: { g: { rounds: 2, label: 'Core', cid: 'c1' } }, entries: [
        { id: A, sg: 'g', sets: [{ r: 12, done: true }, { r: 12, done: true }] },
        { id: B, sg: 'g', sets: [{ r: 15, done: true }, { r: 15, done: true }] }
      ] }
    ]
  }
  it('lists each logged run newest first with rounds and total reps', () => {
    const runs = circuitRuns(S)
    expect(runs).toHaveLength(2)
    expect(runs[0].date).toBe('2026-02-08')
    expect(runs[0].rounds).toBe(2)
    expect(runs[1].rounds).toBe(3)
    expect(runs[1].reps).toBe(76)   // 12+12+10 + 15+15+12
  })
  it('falls back to matching on the label when a run has no cid', () => {
    const s2 = { circuits: S.circuits, workouts: [{ d: '2026-03-01', cg: { g: { rounds: 3, label: 'Core' } }, entries: [
      { id: A, sg: 'g', sets: [{ r: 10, done: true }] }
    ] }] }
    expect(circuitRuns(s2)).toHaveLength(1)
  })
  it('ignores workouts with no circuit meta', () => {
    expect(circuitRuns({ circuits: S.circuits, workouts: [{ d: '2026-01-01', entries: [] }] })).toEqual([])
  })
})
