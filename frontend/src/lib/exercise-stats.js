// Per-exercise history — every past session one lift appeared in, plus the summary numbers
// the detail sheet and the Stats "exercise progress" card both read. Pure over state S.
import { modeOf } from './history.js'
import { bestSetOf } from './onerm.js'
import { avgRir } from './effort.js'

// The mode an exercise was most recently logged in — decides what its charts mean (top
// weight vs longest hold vs top speed). Same fallback chain modeOf uses for a bare entry.
export function exerciseMode(S, exId) {
  const ws = S.workouts || []
  for (let i = ws.length - 1; i >= 0; i--) {
    const en = ws[i].entries.find(e => e.id === exId)
    if (en) return modeOf({ ...(en.target || {}), id: exId })
  }
  return modeOf({ id: exId })
}

// The value a set contributes to the trend, in the exercise's current mode. Sets logged in
// another mode lack the field and score 0, so a switched exercise drops its old points
// instead of mixing seconds into a weight chart (matches views/Stats.jsx).
const metricOf = mode => s =>
  mode === 'cardio' ? (s.speed || 0) : mode === 'time' ? (s.sec || 0) : (s.w || 0)

// One row per past workout this exercise appeared in, chronological (oldest first):
//   { w, d, t, target, mode, sets:[done], top, e1rm, vol, rir, pr }
export function exerciseSessions(S, exId) {
  const mode = exerciseMode(S, exId)
  const m = metricOf(mode)
  const out = []
  ;(S.workouts || []).forEach(w => {
    const en = w.entries.find(e => e.id === exId)
    if (!en) return
    const done = (en.sets || []).filter(s => s.done)
    const topW = mode === 'reps' ? (en.topW || 0) : 0
    if (!done.length && topW <= 0) return
    const best = bestSetOf(en)
    out.push({
      w, d: w.d, t: w.start || new Date(w.d).getTime(), target: en.target || null, mode,
      sets: done,
      top: Math.max(0, topW, ...done.map(m)),
      e1rm: best ? best.est : 0,
      vol: done.reduce((a, s) => a + (s.w || 0) * (s.r || 0), 0),
      rir: avgRir(done),
      pr: !!(w.prs && w.prs.includes(exId))
    })
  })
  return out
}

// Headline numbers across all of history for one exercise, or null if it was never logged.
export function exerciseSummary(S, exId) {
  const s = exerciseSessions(S, exId)
  if (!s.length) return null
  const max = sel => s.reduce((best, r) => (sel(r) > best ? sel(r) : best), 0)
  return {
    sessions: s.length,
    totalSets: s.reduce((a, r) => a + r.sets.length, 0),
    first: s[0].d,
    last: s[s.length - 1].d,
    mode: s[s.length - 1].mode,
    bestTop: max(r => r.top),
    bestE1rm: max(r => r.e1rm),
    bestVol: max(r => r.vol)
  }
}
