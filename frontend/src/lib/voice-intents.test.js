import { test, expect } from 'vitest'
import { parseIntent, parseNumber, extractLogSet } from './voice-intents.js'

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

// real-phone STT transcripts + clean phrasings
const logCases = [
  ['log 8 reps at 60 kilos', { reps: 8, weight: 60 }],
  ['log eight reps at sixty kilos', { reps: 8, weight: 60 }],
  ['record 10 at 100', { reps: 10, weight: 100 }],
  ['8 reps at 60', { reps: 8, weight: 60 }],
  ['six reps 80 kilos', { reps: 6, weight: 80 }],
  ['6 x 60', { reps: 6, weight: 60 }],
  ['6 * 60 kilos', { reps: 6, weight: 60 }],
  ['eight sixty', { reps: 8, weight: 60 }],
  ['60 kilos for 8 reps', { weight: 60, reps: 8 }],
  ['60 for 8', { weight: 60, reps: 8 }],
  ['did 12 reps', { reps: 12 }],
  ['log 15', { reps: 15 }],
  ['twelve reps bodyweight', { reps: 12 }],
  ['put 42.5 for 5', { weight: 42.5, reps: 5 }],
]
for (const [phrase, args] of logCases) {
  test(`log: "${phrase}"`, () => {
    const r = parseIntent(phrase)
    expect(r.intent).toBe('log_set')
    for (const k of Object.keys(args)) expect(r.args[k]).toBe(args[k])
  })
}

const cases = [
  ['set the weight to 42.5', 'set_weight', { weight: 42.5 }],
  ['make it 70 kilos', 'set_weight', { weight: 70 }],
  ['set reps to 6', 'set_reps', { reps: 6 }],
  ['add a set', 'add_set'],
  ['add another set', 'add_set'],
  ['add 3 sets', 'add_set', { count: 3 }],
  ['add three more sets', 'add_set', { count: 3 }],
  ['one more set', 'add_set'],
  ['copy the previous set', 'add_set'],
  ['copy previous sets', 'add_set'],
  ['remove a set', 'remove_set'],
  ['drop 2 sets', 'remove_set', { count: 2 }],
  ['remove the last set', 'remove_set'],
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
  ['done', 'mark_done'],
  ['got it', 'mark_done'],
  ['log it', 'mark_done'],
  ['can you hear me', 'unknown'],
  ['what is the weather', 'unknown'],
  ['', 'empty'],
]
for (const [phrase, intent, args] of cases) {
  test(`intent: "${phrase}" -> ${intent}`, () => {
    const r = parseIntent(phrase)
    expect(r.intent).toBe(intent)
    if (args) for (const k of Object.keys(args)) expect(r.args[k]).toBe(args[k])
  })
}

test('extractLogSet rejects non-log noise', () => {
  expect(extractLogSet('can you hear me')).toBe(null)
  expect(extractLogSet('what should i do next')).toBe(null)
})
