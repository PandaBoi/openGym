// Milestone 3 intent parser — a small spoken grammar for driving a guided workout.
// Deterministic regex, no model. Milestone 4 replaces this with an on-device LLM that
// emits the same { intent, args } shapes, so voice-agent.js stays untouched.

const WORD_NUM = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
}

// "sixty" -> 60, "a hundred and five" -> 105, "twenty two" -> 22, "22.5" -> 22.5
export function parseNumber(str) {
  if (str == null) return null
  const s = String(str).trim().toLowerCase()
  if (s === '') return null
  const dm = s.match(/-?\d+(\.\d+)?/)
  if (dm && /^[\d.\s]+$/.test(s.replace(/-/g, ''))) return parseFloat(dm[0])
  const tokens = s.replace(/-/g, ' ').split(/\s+/).filter(w => w && w !== 'and' && w !== 'a')
  let total = 0, cur = 0, saw = false
  for (const w of tokens) {
    if (!(w in WORD_NUM)) {
      // allow a trailing bare number mixed with words ("hundred 5")
      if (/^\d+(\.\d+)?$/.test(w)) { cur += parseFloat(w); saw = true; continue }
      return dm ? parseFloat(dm[0]) : null
    }
    const v = WORD_NUM[w]
    saw = true
    if (v === 100) cur = (cur || 1) * 100
    else cur += v
  }
  total += cur
  return saw ? total : (dm ? parseFloat(dm[0]) : null)
}

// A number is digits ("60", "42.5") or a run of number-words ("sixty", "twenty two",
// "a hundred and five") — never an arbitrary word, so it can't swallow "to" / "reps".
// longest-first so the alternation matches "sixty" before "six", "fifteen" before "five"
const NW = Object.keys(WORD_NUM).sort((a, b) => b.length - a.length).join('|')
const NUM = `((?:\\d+(?:\\.\\d+)?)|(?:(?:a\\s+)?(?:${NW})(?:[\\s-](?:and\\s+)?(?:${NW}))*))`
const re = (p, flags = 'i') => new RegExp(p, flags)

// Order matters — first match wins.
const RULES = [
  // ---- logging a set --------------------------------------------------------
  // "log 8 reps at 60 kilos" / "log 8 at 60" / "log eight reps sixty kilos"
  { intent: 'log_set', rx: re(`\\b(?:log|record|done|did|completed)\\b.*?${NUM}\\s*(?:reps?)?\\s*(?:at|@|with|by|x|times|for)\\s*${NUM}\\s*(?:kg|kgs|kilos?|kilograms?|pounds?|lbs?)?`),
    take: m => ({ reps: parseNumber(m[1]), weight: parseNumber(m[2]) }) },
  // "8 reps at 60" without the leading verb
  { intent: 'log_set', rx: re(`^${NUM}\\s*reps?\\s*(?:at|@|with|by|x|for)\\s*${NUM}\\s*(?:kg|kgs|kilos?|pounds?|lbs?)?$`),
    take: m => ({ reps: parseNumber(m[1]), weight: parseNumber(m[2]) }) },
  // "60 for 8" / "60 kilos for 8 reps"
  { intent: 'log_set', rx: re(`^${NUM}\\s*(?:kg|kgs|kilos?|pounds?|lbs?)\\s*(?:for|x|times)\\s*${NUM}\\s*(?:reps?)?$`),
    take: m => ({ weight: parseNumber(m[1]), reps: parseNumber(m[2]) }) },
  // bodyweight: "log 12 reps" / "log 12" / "12 bodyweight" / "did 10 pull ups"
  { intent: 'log_set', rx: re(`\\b(?:log|record|done|did|completed)\\b\\D*?${NUM}\\s*(?:reps?)?\\b(?:.*\\b(?:body\\s*weight|bodyweight|no weight))?\\s*$`),
    take: m => ({ reps: parseNumber(m[1]) }) },

  // ---- set the pre-filled numbers without checking the set off --------------
  { intent: 'set_weight', rx: re(`\\b(?:set|change|make)\\b.*\\bweight\\b.*?${NUM}`), take: m => ({ weight: parseNumber(m[1]) }) },
  { intent: 'set_weight', rx: re(`\\b(?:make it|use)\\s*${NUM}\\s*(?:kg|kgs|kilos?|pounds?|lbs?)\\b`), take: m => ({ weight: parseNumber(m[1]) }) },
  { intent: 'set_reps', rx: re(`\\b(?:set|change|make)\\b.*\\breps?\\b.*?${NUM}`), take: m => ({ reps: parseNumber(m[1]) }) },

  // ---- sets ---------------------------------------------------------------
  { intent: 'add_set', rx: /\b(add|another|one more)\b.*\bset\b|\badd a set\b/i },
  { intent: 'remove_set', rx: /\b(remove|delete|drop|take off)\b.*\bset\b/i },

  // ---- navigation -------------------------------------------------------
  { intent: 'next_exercise', rx: /\b(next|move on|following)\b.*\bexercise\b|^\s*next\s*$|\bnext one\b|\bmove on\b/i },
  { intent: 'prev_exercise', rx: /\b(previous|last|go back|back to)\b.*\bexercise\b|^\s*(previous|back|go back)\s*$/i },

  // ---- rest timer ------------------------------------------------------
  { intent: 'stop_rest', rx: /\b(stop|skip|cancel|end|kill)\b.*\brest\b|\bskip (the )?rest\b|\bi'?m ready\b|\bnext set\b/i },
  // rest with a duration ("rest 90 seconds", "rest two minutes"), or an explicit start
  { intent: 'start_rest', rx: re(`\\brest\\b(?:\\s*timer)?\\s*(?:for\\s*)?${NUM}\\s*(seconds?|secs?|minutes?|mins?)?`),
    take: m => {
      const n = parseNumber(m[1])
      const isMin = /^m/i.test(m[2] || '')
      return n ? { seconds: isMin ? n * 60 : n } : {}
    } },
  { intent: 'start_rest', rx: /\b(start|begin|set)\b\s*(a |the )?rest\b|\brest timer\b|^\s*rest\s*$/i, take: () => ({}) },

  // ---- questions ------------------------------------------------------
  { intent: 'whats_target', rx: /\b(what('| i)?s|what is)\b.*\b(target|prescription|supposed to|should i (do|lift|hit))\b|\bwhat do i do\b|\bhow many\b.*\breps\b/i },
  { intent: 'last_time', rx: /\blast (time|session|week)\b|\bwhat did i (do|lift|hit)\b/i },
  { intent: 'how_many_sets', rx: /\bhow many sets\b|\bsets (left|to go|remaining)\b|\bwhere am i\b/i },

  // ---- workout control -------------------------------------------------
  { intent: 'finish_workout', rx: /\b(finish|end|complete|done with|wrap up)\b.*\bworkout\b|\bi'?m done\b|\bend session\b/i },
  { intent: 'cancel', rx: /\b(never ?mind|cancel|forget it|stop)\b/i },
]

export function parseIntent(text) {
  const raw = (text || '').trim()
  if (!raw) return { intent: 'empty', raw }
  for (const r of RULES) {
    const m = raw.match(r.rx)
    if (m) {
      const args = r.take ? r.take(m) : {}
      // reject a "log" match that produced no usable number
      if (r.intent === 'log_set' && args.reps == null && args.weight == null) continue
      return { intent: r.intent, args, raw }
    }
  }
  return { intent: 'unknown', raw }
}
