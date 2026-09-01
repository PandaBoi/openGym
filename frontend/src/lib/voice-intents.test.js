import { test, expect } from 'vitest'
import { parseIntent, parseNumber } from './voice-intents.js'

test('parseNumber', () => {
  expect(parseNumber('60')).toBe(60)
  expect(parseNumber('22.5')).toBe(22.5)
  expect(parseNumber('sixty')).toBe(60)
  expect(parseNumber('twenty two')).toBe(22)
  expect(parseNumber('a hundred and five')).toBe(105)
  expect(parseNumber('one hundred')).toBe(100)
  expect(parseNumber('eight')).toBe(8)
  expect(parseNumber('')).toBe(null)
})

const cases = [
  ['log 8 reps at 60 kilos', 'log_set', { reps: 8, weight: 60 }],
  ['log eight reps at sixty kilos', 'log_set', { reps: 8, weight: 60 }],
  ['record 10 at 100', 'log_set', { reps: 10, weight: 100 }],
  ['8 reps at 60', 'log_set', { reps: 8, weight: 60 }],
  ['60 kilos for 8 reps', 'log_set', { weight: 60, reps: 8 }],
  ['did 12 reps', 'log_set', { reps: 12 }],
  ['log 15', 'log_set', { reps: 15 }],
  ['set the weight to 42.5', 'set_weight', { weight: 42.5 }],
  ['make it 70 kilos', 'set_weight', { weight: 70 }],
  ['set reps to 6', 'set_reps', { reps: 6 }],
  ['add a set', 'add_set'],
  ['add another set', 'add_set'],
  ['remove a set', 'remove_set'],
  ['next exercise', 'next_exercise'],
  ['next', 'next_exercise'],
  ['move on', 'next_exercise'],
  ['previous exercise', 'prev_exercise'],
  ['go back', 'prev_exercise'],
  ['start rest timer', 'start_rest', {}],
  ['start rest for 90 seconds', 'start_rest', { seconds: 90 }],
  ['rest two minutes', 'start_rest', { seconds: 120 }],
  ['skip rest', 'stop_rest'],
  ["what's my target", 'whats_target'],
  ['how many reps should i do', 'whats_target'],
  ['what did i do last time', 'last_time'],
  ['how many sets left', 'how_many_sets'],
  ['finish workout', 'finish_workout'],
  ["i'm done", 'finish_workout'],
  ['banana pancakes', 'unknown'],
  ['', 'empty'],
]

for (const [phrase, intent, args] of cases) {
  test(`intent: "${phrase}" -> ${intent}`, () => {
    const r = parseIntent(phrase)
    expect(r.intent).toBe(intent)
    if (args) for (const k of Object.keys(args)) expect(r.args[k]).toBe(args[k])
  })
}
