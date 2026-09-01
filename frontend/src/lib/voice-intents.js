// Milestone 3 intent parser — a small spoken grammar for driving a guided workout.
// Deterministic, no model. Real phone STT is messy ("six reps 80 kilos", "6 x 60",
// "eight sixty"), so log-set detection is a tolerant number extractor rather than a
// fixed phrase. Milestone 4 swaps this for an on-device LLM emitting the same
// { intent, args } shapes, so voice-agent.js is unaffected.

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
  let cur = 0, saw = false
  for (const w of tokens) {
    if (!(w in WORD_NUM)) {
      if (/^\d+(\.\d+)?$/.test(w)) { cur += parseFloat(w); saw = true; continue }
      return dm ? parseFloat(dm[0]) : null
    }
    const v = WORD_NUM[w]
    saw = true
    if (v === 100) cur = (cur || 1) * 100
    else cur += v
  }
  return saw ? cur : (dm ? parseFloat(dm[0]) : null)
}

const NW = Object.keys(WORD_NUM).sort((a, b) => b.length - a.length).join('|')
const NUM = `((?:\\d+(?:\\.\\d+)?)|(?:(?:a\\s+)?(?:${NW})(?:[\\s-](?:and\\s+)?(?:${NW}))*))`
const re = (p, flags = 'i') => new RegExp(p, flags)

const REPS_TOK = /^reps?$/
const WT_TOK = /^(kg|kgs|kilo|kilos|kilogram|kilograms|pound|pounds|lb|lbs)$/

// consume ONE number starting at tokens[i]; -> { value, next } | null.
// A lone digit token is that number ("8" "60" stays two numbers). Word numbers form a
// canonical run only — "twenty two" = 22, "a hundred and five" = 105, but "eight sixty"
// = 8 then 60 (nobody says "eight sixty" to mean 68 or 860).
function readNumberRun(tokens, i) {
  const t0 = tokens[i].replace(/-/g, '')
  if (/^\d+(\.\d+)?$/.test(t0)) return { value: parseFloat(t0), next: i + 1 }

  const acc = []
  let j = i
  if (t0 === 'a' && tokens[j + 1] && tokens[j + 1].replace(/-/g, '') in WORD_NUM) { acc.push('a'); j++ }
  while (j < tokens.length) {
    const w = tokens[j].replace(/-/g, '')
    if (w in WORD_NUM) {
      const prev = acc[acc.length - 1]
      const prevVal = prev && prev !== 'a' && prev !== 'and' ? WORD_NUM[prev] : null
      if (prevVal != null) {
        const tensOnes = prevVal >= 20 && prevVal % 10 === 0 && WORD_NUM[w] >= 1 && WORD_NUM[w] <= 9
        const hundred = w === 'hundred' && prevVal < 100
        if (!tensOnes && !hundred) break
      }
      acc.push(w); j++; continue
    }
    if (w === 'and' && acc.includes('hundred') && tokens[j + 1] && tokens[j + 1].replace(/-/g, '') in WORD_NUM) { acc.push('and'); j++; continue }
    break
  }
  if (!acc.filter(x => x !== 'a' && x !== 'and').length) return null
  const value = parseNumber(acc.join(' '))
  return value == null ? null : { value, next: j }
}

// Tolerant "log a set" extractor. Returns { reps?, weight? } or null.
export function extractLogSet(raw) {
  // strip punctuation but keep a decimal point between digits ("42.5")
  const norm = raw.toLowerCase().replace(/[×*]/g, ' x ').replace(/@/g, ' at ')
    .replace(/[!?]/g, ' ').replace(/(?<!\d)[.,]|[.,](?!\d)/g, ' ')
  const tokens = norm.split(/\s+/).filter(Boolean)
  if (!tokens.length) return null

  const nums = []   // { value, unit: 'reps'|'weight'|'none', at }
  for (let i = 0; i < tokens.length;) {
    const r = readNumberRun(tokens, i)
    if (!r) { i++; continue }
    let unit = 'none'
    const after = tokens[r.next]
    const before = tokens[i - 1]
    if (after && REPS_TOK.test(after)) unit = 'reps'
    else if (after && WT_TOK.test(after)) unit = 'weight'
    else if (before && REPS_TOK.test(before)) unit = 'reps'
    else if (before && WT_TOK.test(before)) unit = 'weight'
    nums.push({ value: r.value, unit, at: i })
    i = r.next
  }
  if (!nums.length) return null

  let reps = nums.find(n => n.unit === 'reps')?.value
  let weight = nums.find(n => n.unit === 'weight')?.value
  const free = nums.filter(n => n.unit === 'none')

  if (reps == null && weight == null) {
    if (nums.length >= 2) {
      const forIdx = tokens.indexOf('for')
      // "60 for 8" => weight then reps ; otherwise "8 at 60" / "8 60" => reps then weight
      if (forIdx > -1 && nums[0].at < forIdx && forIdx < nums[1].at) { weight = nums[0].value; reps = nums[1].value }
      else { reps = nums[0].value; weight = nums[1].value }
    } else {
      reps = nums[0].value   // single number, no unit -> a bodyweight rep count
    }
  } else {
    if (reps == null && free.length) reps = free[0].value
    if (weight == null && free.length && free[0].value !== reps) weight = free[0].value
  }

  // gate: only fire mid-sentence noise as a log if there's a real signal
  const hasVerb = /\b(log|logged|record|recorded|did|done|complete|completed|put|mark|marked|enter|entered|add(?:ed)?|got)\b/.test(norm)
  const hasKw = /\b(reps?|kg|kgs|kilos?|kilograms?|pounds?|lbs?|set|rep)\b/.test(norm)
  const shortNumeric = tokens.length <= 6 && nums.length >= 2
  if (!hasVerb && !hasKw && !shortNumeric) return null
  if (reps == null && weight == null) return null

  const out = {}
  if (reps != null) out.reps = reps
  if (weight != null) out.weight = weight
  return out
}

// Order matters — first match wins. (log-set is handled separately, after these.)
const RULES = [
  { intent: 'set_weight', rx: re(`\\b(?:set|change|make|adjust)\\b.*\\bweight\\b.*?${NUM}`), take: m => ({ weight: parseNumber(m[1]) }) },
  { intent: 'set_weight', rx: re(`\\b(?:make it|use|change to)\\s*${NUM}\\s*(?:kg|kgs|kilos?|pounds?|lbs?)\\b`), take: m => ({ weight: parseNumber(m[1]) }) },
  { intent: 'set_reps', rx: re(`\\b(?:set|change|make|adjust)\\b.*\\breps?\\b.*?${NUM}`), take: m => ({ reps: parseNumber(m[1]) }) },

  { intent: 'add_set', rx: /\b(add|another|one more)\b.*\bset\b|\badd a set\b/i },
  { intent: 'remove_set', rx: /\b(remove|delete|drop|take off)\b.*\bset\b/i },

  { intent: 'next_exercise', rx: /\b(next|move on|following)\b.*\bexercise\b|^\s*next\s*$|\bnext one\b|\bmove on\b/i },
  { intent: 'prev_exercise', rx: /\b(previous|last|go back|back to)\b.*\bexercise\b|^\s*(previous|back|go back)\s*$/i },

  { intent: 'stop_rest', rx: /\b(stop|skip|cancel|end|kill)\b.*\brest\b|\bskip (the )?rest\b|\bi'?m ready\b|\bnext set\b/i },
  { intent: 'start_rest', rx: re(`\\brest\\b(?:\\s*timer)?\\s*(?:for\\s*)?${NUM}\\s*(seconds?|secs?|minutes?|mins?)?`),
    take: m => { const n = parseNumber(m[1]); const isMin = /^m/i.test(m[2] || ''); return n ? { seconds: isMin ? n * 60 : n } : {} } },
  { intent: 'start_rest', rx: /\b(start|begin|set)\b\s*(a |the )?rest\b|\brest timer\b|^\s*rest\s*$/i, take: () => ({}) },

  { intent: 'whats_target', rx: /\b(what('| i)?s|what is)\b.*\b(target|prescription|supposed to|should i (do|lift|hit))\b|\bwhat do i do\b|\bhow many\b.*\breps\b/i },
  { intent: 'last_time', rx: /\blast (time|session|week)\b|\bwhat did i (do|lift|hit)\b/i },
  { intent: 'how_many_sets', rx: /\bhow many sets\b|\bsets (left|to go|remaining)\b|\bwhere am i\b/i },

  { intent: 'finish_workout', rx: /\b(finish|end|complete|done with|wrap up)\b.*\bworkout\b|\bi'?m done\b|\bend session\b/i },
  { intent: 'cancel', rx: /\b(never ?mind|forget it)\b/i },
]

const MARK_DONE = /^(log it|logged|mark(ed)? it|mark done|got it|check( it)?|that'?s (it|done)|done|complete)$/

export function parseIntent(text) {
  const raw = (text || '').trim()
  if (!raw) return { intent: 'empty', raw }
  if (MARK_DONE.test(raw.toLowerCase().replace(/[.!]/g, '').trim())) return { intent: 'mark_done', args: {}, raw }
  for (const r of RULES) {
    const m = raw.match(r.rx)
    if (m) return { intent: r.intent, args: r.take ? r.take(m) : {}, raw }
  }
  const ls = extractLogSet(raw)
  if (ls) return { intent: 'log_set', args: ls, raw }
  return { intent: 'unknown', raw }
}
