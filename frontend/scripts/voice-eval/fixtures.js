// Deterministic store state for the voice-agent benchmark.
//
// baseState() returns an override object that the runner spreads over a cloned
// live store state (same shape the unit tests build by hand). It sets up:
//   · a live workout: 2 exercises, 6 sets total, 2 done / 4 left, ~18 min in
//   · ~8 weeks of history for bench press (id 0025) + one accessory (id 0042)
//   · body-weight trend, a weekly plan
// Exercise ids: 0025 = "Bench Press", 0042 = an accessory (both proven in
// voice-llm-agent.test.js).

const DAY = 864e5

function daysAgo(n, now) {
  return new Date(now - n * DAY).toISOString().slice(0, 10)
}

// A finished workout: entries = [[exId, [[weight,reps], ...]], ...]
function wk(nDaysAgo, name, entries, now) {
  const start = now - nDaysAgo * DAY
  let vol = 0
  const built = entries.map(([id, sets]) => ({
    id,
    target: {},
    sets: sets.map(([w, r]) => { vol += w * r; return { w, r, done: true } }),
  }))
  return { id: `h${nDaysAgo}`, d: daysAgo(nDaysAgo, now), start, end: start + 45 * 60000, name, vol: Math.round(vol), prs: [], entries: built }
}

export function baseState(now = Date.now()) {
  return {
    unit: 'kg',
    restSec: 90,
    sound: false,
    keepAwake: false,
    user: null,
    customEx: [],
    exWeights: {},
    routines: [
      { id: 'rA', name: 'Upper A', ex: [{ id: '0025' }, { id: '0042' }] },
      { id: 'rB', name: 'Lower A', ex: [{ id: '0042' }] },
    ],
    week: { 1: 'rA', 3: 'rB', 5: 'rA' }, // Mon / Wed / Fri
    workouts: [
      wk(58, 'Upper A', [['0025', [[60, 8], [60, 8], [62.5, 6]]]], now),
      wk(44, 'Upper A', [['0025', [[62.5, 8], [62.5, 7]]], ['0042', [[80, 10], [80, 9]]]], now),
      wk(30, 'Upper A', [['0025', [[65, 6], [65, 6]]]], now),
      wk(16, 'Upper A', [['0025', [[65, 8], [67.5, 5]]]], now),
      wk(7, 'Upper A', [['0025', [[67.5, 7], [67.5, 6]]], ['0042', [[85, 8]]]], now),
      wk(2, 'Upper A', [['0025', [[70, 6], [70, 5]]]], now),
    ],
    bodyweight: [
      { d: daysAgo(60, now), w: 80, t: now - 60 * DAY },
      { d: daysAgo(28, now), w: 79, t: now - 28 * DAY },
      { d: daysAgo(3, now), w: 78.2, t: now - 3 * DAY },
    ],
    active: {
      id: 'wLive',
      d: daysAgo(0, now),
      start: now - 18 * 60000,
      routineId: null,
      name: 'Upper A',
      bw: null,
      cur: 0,
      entries: [
        {
          id: '0025',
          target: { sets: 3, reps: 8, weight: 0, mode: 'reps' },
          plan: { kind: 'hold', weight: 70, reps: 8 },
          sets: [
            { w: 70, r: 8, done: true },
            { w: 70, r: 7, done: true },
            { w: 70, r: 8, done: false },
          ],
        },
        {
          id: '0042',
          target: { sets: 3, reps: 10, weight: 0, mode: 'reps' },
          plan: { kind: 'hold', weight: 85, reps: 10 },
          sets: [
            { w: 85, r: 10, done: false },
            { w: 85, r: 10, done: false },
            { w: 85, r: 10, done: false },
          ],
        },
      ],
    },
  }
}

// A "no workout running" variant for the idle-state cases.
export function idleState(now = Date.now()) {
  const s = baseState(now)
  s.active = null
  return s
}
