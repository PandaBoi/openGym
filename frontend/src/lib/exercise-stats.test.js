import { describe, it, expect } from 'vitest'
import { exerciseMode, exerciseSessions, exerciseSummary } from './exercise-stats.js'

const w = (d, entries, extra = {}) => ({ id: d, d, start: new Date(d + 'T12:00:00').getTime(), name: 'Day', entries, ...extra })
const set = (o) => ({ done: true, ...o })

const S = () => ({
  unit: 'kg',
  workouts: [
    w('2026-01-01', [{ id: 'bench', target: { mode: 'reps' }, sets: [set({ w: 60, r: 8 }), set({ w: 60, r: 8 }), set({ w: 60, r: 6 })] }]),
    w('2026-01-08', [
      { id: 'bench', target: { mode: 'reps' }, sets: [set({ w: 65, r: 8 }), set({ w: 65, r: 5 }), { done: false, w: 65, r: 0 }] },
      { id: 'plank', target: { mode: 'time' }, sets: [set({ sec: 60, w: 0 })] }
    ], { prs: ['bench'] }),
    w('2026-01-15', [{ id: 'squat', target: { mode: 'reps' }, sets: [set({ w: 100, r: 5 })] }])
  ]
})

describe('exerciseSessions', () => {
  it('returns one row per workout the exercise appears in, chronological', () => {
    const rows = exerciseSessions(S(), 'bench')
    expect(rows.map(r => r.d)).toEqual(['2026-01-01', '2026-01-08'])
  })

  it('counts only completed sets and picks the top working weight', () => {
    const [, second] = exerciseSessions(S(), 'bench')
    expect(second.sets).toHaveLength(2)          // the undone set is dropped
    expect(second.top).toBe(65)
    expect(second.vol).toBe(65 * 8 + 65 * 5)
    expect(second.pr).toBe(true)
  })

  it('estimates a 1RM from the best completed set', () => {
    const [first] = exerciseSessions(S(), 'bench')
    expect(first.e1rm).toBeGreaterThan(60)       // 60x8 epley ≈ 76
  })

  it('scores a timed exercise by hold length, not weight', () => {
    const [row] = exerciseSessions(S(), 'plank')
    expect(row.mode).toBe('time')
    expect(row.top).toBe(60)
  })

  it('is empty for an exercise never logged', () => {
    expect(exerciseSessions(S(), 'deadlift')).toEqual([])
  })
})

describe('exerciseSummary', () => {
  it('rolls up the bests and the span', () => {
    const sum = exerciseSummary(S(), 'bench')
    expect(sum.sessions).toBe(2)
    expect(sum.totalSets).toBe(5)
    expect(sum.first).toBe('2026-01-01')
    expect(sum.last).toBe('2026-01-08')
    expect(sum.bestTop).toBe(65)
    expect(sum.bestVol).toBe(60 * 8 + 60 * 8 + 60 * 6)   // heaviest-volume session
  })

  it('is null when there is nothing logged', () => {
    expect(exerciseSummary(S(), 'deadlift')).toBeNull()
  })
})

describe('exerciseMode', () => {
  it('reads the most recent logged mode', () => {
    expect(exerciseMode(S(), 'plank')).toBe('time')
    expect(exerciseMode(S(), 'bench')).toBe('reps')
  })
  it('falls back to reps for an unknown exercise', () => {
    expect(exerciseMode(S(), 'nope')).toBe('reps')
  })
})
