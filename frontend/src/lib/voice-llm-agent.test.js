import './test-dom-shim.js'
import { test, expect, beforeEach, vi } from 'vitest'

vi.mock('../sheets.jsx', () => ({ finishWorkout: vi.fn() }))

import { useStore } from '../store/useStore.js'
import { runAgent, extractJson, buildSystemPrompt, stateSnapshot } from './voice-llm-agent.js'

const A = () => useStore.getState().S.active

beforeEach(() => {
  useStore.getState().replaceState({
    ...JSON.parse(JSON.stringify(useStore.getState().S)),
    unit: 'kg', restSec: 90, sound: false, routines: [], exWeights: {},
    workouts: [
      { id: 'h1', d: '2026-08-01', start: 1, end: 1 + 40 * 60000, name: 'Upper', vol: 4000, prs: [],
        entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 7, done: true }], target: {} }] },
    ],
    bodyweight: [{ d: '2026-08-01', w: 80, t: 1 }, { d: '2026-08-28', w: 78.5, t: 2 }],
    active: {
      id: 'w1', d: '2026-08-31', start: Date.now() - 12 * 60000, routineId: null, name: 'Test', bw: null, cur: 0,
      entries: [
        { id: '0025', target: { sets: 2, reps: 8, weight: 0, mode: 'reps' }, plan: { kind: 'hold', weight: 60, reps: 8 },
          sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }] },
        { id: '0042', target: { sets: 2, reps: 6, weight: 0, mode: 'reps' }, plan: { kind: 'hold' },
          sets: [{ w: 80, r: 6, done: false }, { w: 80, r: 6, done: false }] },
      ],
    },
  })
})

// a scripted "model": returns queued responses in order
const scripted = (...replies) => {
  let i = 0
  return vi.fn(async () => replies[Math.min(i++, replies.length - 1)])
}

test('extractJson handles fences and prose', () => {
  expect(extractJson('```json\n{"say":"hi"}\n```')).toEqual({ say: 'hi' })
  expect(extractJson('sure: {"tool":"get_stats","args":{"range":"week"}} done')).toEqual({ tool: 'get_stats', args: { range: 'week' } })
  expect(extractJson('no json here')).toBe(null)
})

test('system prompt lists the tools', () => {
  const p = buildSystemPrompt()
  expect(p).toMatch(/get_workout_state/)
  expect(p).toMatch(/log_set/)
  expect(p).toMatch(/ONE JSON object/)
})

test('answers "how many exercises / how long" from one tool call', async () => {
  const gen = scripted(
    '{"tool":"get_workout_state","args":{}}',
    '{"say":"You are on exercise 1 of 2, 1 of 4 sets done, about 12 minutes in."}',
  )
  const r = await runAgent('how many exercises have I done and how long have I been going', gen)
  expect(r.steps[0].tool).toBe('get_workout_state')
  expect(r.steps[0].result.exerciseCount).toBe(2)
  expect(r.speak).toMatch(/exercise 1 of 2/i)
  expect(gen).toHaveBeenCalledTimes(2)
})

test('logs a set through a tool call', async () => {
  const gen = scripted(
    '{"tool":"log_set","args":{"reps":7,"weight":62.5}}',
    '{"say":"Logged 62.5 for 7."}',
  )
  await runAgent('log seven reps at sixty two point five', gen)
  const s = A().entries[0].sets[1]
  expect(s).toMatchObject({ w: 62.5, r: 7, done: true })
})

test('multi-step: exercise history then a verdict', async () => {
  const gen = scripted(
    '{"tool":"get_exercise_history","args":{"exercise":"bench press","weeks":8}}',
    '{"say":"Your bench is trending up. Go for 62.5 today."}',
  )
  const r = await runAgent("how's my bench been", gen)
  expect(r.steps[0].result.exercise).toMatch(/bench press/i)
  expect(r.speak).toMatch(/bench/i)
})

test('bad JSON gets one nudge then recovers', async () => {
  const gen = scripted('I think you should...', '{"say":"ok"}')
  const r = await runAgent('hi', gen)
  expect(r.speak).toBe('ok')
})

test('runs out of steps gracefully', async () => {
  const gen = scripted('{"tool":"get_stats","args":{}}')   // never says anything
  const r = await runAgent('stats', gen, { maxSteps: 3 })
  expect(r.exhausted).toBe(true)
  expect(typeof r.speak).toBe('string')
})

test('stateSnapshot is compact and reflects the active workout', () => {
  const snap = stateSnapshot()
  expect(snap).toMatch(/Exercise 1\/2/)
  expect(snap).toMatch(/min elapsed/)
})
