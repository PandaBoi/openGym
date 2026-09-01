import './test-dom-shim.js'   // must be first — sets up document/localStorage for the store
import { test, expect, beforeEach, vi } from 'vitest'

// finishWorkout pulls in the whole sheets.jsx / React tree — stub it, we only assert it's called.
vi.mock('../sheets.jsx', () => ({ finishWorkout: vi.fn() }))

import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { parseIntent } from './voice-intents.js'
import { runIntent } from './voice-agent.js'
import { finishWorkout } from '../sheets.jsx'

const say = phrase => runIntent(parseIntent(phrase))
const A = () => useStore.getState().S.active

beforeEach(() => {
  useUI.getState().stopRest?.()
  useStore.getState().replaceState({
    ...JSON.parse(JSON.stringify(useStore.getState().S)),
    unit: 'kg', restSec: 90, sound: false, workouts: [], routines: [], exWeights: {},
    active: {
      id: 'w1', d: '2026-08-31', start: Date.now(), routineId: null, name: 'Test', bw: null, cur: 0,
      entries: [
        { id: '0025', target: { sets: 2, reps: 10, weight: 0, mode: 'reps' }, plan: { kind: 'hold', why: null },
          sets: [{ w: 40, r: 10, done: false }, { w: 40, r: 10, done: false }] },
        { id: '0042', target: { sets: 2, reps: 8, weight: 0, mode: 'reps' }, plan: { kind: 'hold', why: null },
          sets: [{ w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] },
      ],
    },
  })
})

test('log a set fills values, marks done, starts rest after first set', () => {
  const msg = say('log 8 reps at 55 kilos')
  const s0 = A().entries[0].sets[0]
  expect(s0).toMatchObject({ w: 55, r: 8, done: true })
  expect(useUI.getState().timer).toBeTruthy()        // rest started
  expect(msg).toMatch(/set 1 logged/i)
})

test('second log completes the exercise and auto-advances to the next', () => {
  say('log 8 at 55')
  const msg = say('log 7 at 55')
  expect(A().entries[0].sets.every(s => s.done)).toBe(true)
  expect(A().cur).toBe(1)                            // moved to exercise 2
  expect(msg).toMatch(/next/i)
})

test('next / previous exercise', () => {
  expect(say('next exercise')).toMatch(/front squat/i)
  expect(A().cur).toBe(1)
  expect(say('go back')).toMatch(/bench/i)
  expect(A().cur).toBe(0)
})

test('set weight without logging', () => {
  say('set the weight to 42.5')
  expect(A().entries[0].sets[0]).toMatchObject({ w: 42.5, done: false })
})

test('add / remove set', () => {
  say('add a set')
  expect(A().entries[0].sets.length).toBe(3)
  say('remove a set')
  expect(A().entries[0].sets.length).toBe(2)
})

test('start / stop rest', () => {
  expect(say('rest two minutes')).toMatch(/120 seconds/)
  expect(useUI.getState().timer).toBeTruthy()
  say('skip rest')
  expect(useUI.getState().timer).toBeFalsy()
})

test('finish workout delegates to sheets.finishWorkout', () => {
  say('finish workout')
  expect(finishWorkout).toHaveBeenCalled()
})

test('unknown gives a helpful reply, no crash', () => {
  expect(say('make me a sandwich')).toMatch(/didn't catch/i)
})
