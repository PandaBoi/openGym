import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, buildSets, setsDoneActive, supersetUnits, unitOf, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort, circuitOf, circuitRound, defaultConfig } from '../lib/history.js'
import { fmtNum, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet, circuitPickSheet, fmtHold } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Row } from '../components/ui.jsx'
import Stepper from '../components/Stepper.jsx'
import { nextPrescription, applyPrescription } from '../lib/progression.js'
import { glyphOf } from '../lib/glyphs.js'

/* ---------- start chooser (no active workout) ---------- */
function StartChooser() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const todayR = effectiveRoutine(S, todayISO())
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  const others = S.routines.filter(r => r !== todayR)
  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Start workout')}</h1><div className="sub">{t(DAYN[new Date().getDay()])} — {todayR ? t('today is {0}', todayR.name) : t('rest day, but no one’s stopping you')}</div></div></div>
    {todayR && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="accent">{t("Today's plan")}{todayOvr ? ' · ' + t('rescheduled') : ''}</h2>
      <div className="row between" style={{ marginBottom: 12 }}>
        <div><div className="big">{todayR.name}</div><div className="muted small">{exCount(todayR.ex.length)}</div></div>
        <span className="lrow-i" style={{ width: 38, height: 38, borderRadius: 9, fontSize: 22 }}><Icon name={glyphOf(todayR.emoji)} /></span>
      </div>
      <Button variant="primary" icon="play" onClick={() => startFlow(todayR.id)}>{t('Start {0}', todayR.name)}</Button>
    </div>}
    {others.length > 0 && <><h4 className="sec">{t('Other routines')}</h4>
      <div className="list">{others.map(r => <div key={r.id} className="item" onClick={() => startFlow(r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <span className="tag acc">{t('Start')}</span></div>)}</div></>}
    <div style={{ height: 14 }} />
    <Button icon="shuffle" onClick={() => startFlow(null)}>{t('Freestyle workout (pick as you go)')}</Button>
    {!S.routines.length && <><div style={{ height: 10 }} /><Button variant="primary" onClick={() => nav('/plan')}>{t('Build a plan first')}</Button></>}
  </div>
}

/* ---------- elapsed clock (isolated so the workout tree doesn't re-render every second) ---------- */
function Elapsed({ start }) {
  const [t, setT] = useState('0:00')
  useEffect(() => {
    const tick = () => { const s = Math.floor((Date.now() - start) / 1000); setT(Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')) }
    tick(); const iv = setInterval(tick, 1000); return () => clearInterval(iv)
  }, [start])
  return <span>{t}</span>
}

/* ==========================================================================================
   The workout is one scrolling list: every exercise is a card, every set one plain line
   ("60 kg × 8"). Tapping a set opens its sheet (big fields, log / start hold, and the
   per-set options that used to crowd every row). The set you owe next is highlighted and
   scrolled to, so there's no separate "focus" mode and no exercise pager to page through.

   The actions below are module-level and read fresh state each call, so the list rows, the
   set sheet and the exercise menu (each its own React tree under openSheet) all share them.
   ========================================================================================== */
const getS = () => useStore.getState().S
const upd = fn => useStore.getState().update(fn, true)
const ui = () => useUI.getState()
const entryMode = e => modeOf({ ...(e.target || {}), id: e.id })
// A set can carry its own mode (s.mode) independent of the exercise — a single timed hold in
// an otherwise reps-based move. Cardio never carries a per-set override.
const setModeOf = (e, s) => { const m = entryMode(e); return m === 'cardio' ? 'cardio' : (s.mode || m) }
const cfgOf = e => ({ ...(e.target || {}), id: e.id })
// Bodyweight shows a weight only once there is a belt's worth to describe, or once "Add
// weight" asked for it (`e.weighted`) — see issue #32.
const showsWeight = e => entryMode(e) !== 'cardio' && (!isBw(cfgOf(e)) || !!e.weighted || e.sets.some(s => s.w > 0))
// Working-set numbering skips warm-ups: 1, 2, 3… starts after them. An excluded set (s.skip)
// still gets a number — it was performed as a working set, progression just doesn't read it.
const setNumber = (e, i) => i + 1 - e.sets.slice(0, i).filter(x => x.wu).length

// The set you owe next: within the exercise you last worked on (A.cur) if it still has one,
// otherwise the first unfinished one top-down. In a superset/circuit that's the member with
// the fewest sets done (earliest wins a tie) — one set of each, round by round.
export function nextSetOf(A) {
  if (!A || !A.entries.length) return null
  const units = supersetUnits(A.entries)
  const pick = u => {
    const open = u.filter(i => A.entries[i].sets.some(s => !s.done))
    if (!open.length) return null
    const doneOf = i => A.entries[i].sets.filter(s => s.done).length
    const idx = open.reduce((b, i) => doneOf(i) < doneOf(b) ? i : b, open[0])
    return { idx, i: A.entries[idx].sets.findIndex(s => !s.done) }
  }
  const cur = Math.min(A.cur || 0, A.entries.length - 1)
  return pick(unitOf(units, cur)) || units.reduce((hit, u) => hit || pick(u), null)
}

const mutEntry = (idx, fn) => upd(s => { fn(s.active.entries[idx]) })
// Clearing an optional field drops the key rather than storing null, so a set only carries
// what was actually logged — in the session, in history and in a backup.
const setField = (idx, i, field, v) => mutEntry(idx, e => { if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v })

// A new set continues in whatever mode the one before it ended up in, so flipping a set to
// time and then "Add set" keeps adding timed sets.
function pushSet(e) {
  const l = e.sets[e.sets.length - 1]
  const em = entryMode(e)
  const m = (l && l.mode) || em
  const ovr = l && l.mode && l.mode !== em ? { mode: l.mode } : {}
  const tg = e.target || {}
  if (m === 'cardio') e.sets.push({ min: l ? l.min : (tg.min || 20), speed: l ? l.speed : (tg.speed || 8), done: false })
  else if (m === 'time') e.sets.push({ ...ovr, sec: l ? (l.sec || tg.sec || 45) : (tg.sec || 45), w: l ? (l.w || 0) : (tg.weight || 0), done: false })
  else e.sets.push({ ...ovr, w: l ? (l.w || 0) : (tg.weight || 0), r: l ? l.r : tg.reps, done: false })
}
const addSetTo = idxs => upd(s => { idxs.forEach(i => pushSet(s.active.entries[i])) })
const deleteSet = (idx, i) => mutEntry(idx, e => { if (e.sets.length > 1) e.sets.splice(i, 1) })
// Slot a fresh warm-up in right before the next set you owe, seeded from that neighbour.
function insertWarmup(e) {
  const at = e.sets.findIndex(s => !s.done)
  const idx = at === -1 ? e.sets.length : at
  const near = e.sets[idx] || e.sets[idx - 1] || {}
  const m = entryMode(e), tg = e.target || {}
  const row = m === 'cardio' ? { min: near.min ?? (tg.min || 20), speed: near.speed ?? (tg.speed || 8) }
    : m === 'time' ? { sec: near.sec ?? (tg.sec || 45), w: near.w || 0 }
      : { w: near.w || 0, r: near.r ?? tg.reps }
  e.sets.splice(idx, 0, { ...row, done: false, wu: true })
}
const addWarmupTo = idxs => upd(s => { idxs.forEach(i => insertWarmup(s.active.entries[i])) })
// `wu` (warm-up) and `skip` (excluded from progression) are mutually exclusive.
const setFlag = (idx, i, flag) => mutEntry(idx, e => { delete e.sets[i].wu; delete e.sets[i].skip; if (flag) e.sets[i][flag] = true })
// Flip a whole exercise between reps and time — logged values don't carry (they mean
// different things), weight does. Per-set overrides are cleared along with it.
const changeMode = idx => mutEntry(idx, e => {
  const cur = entryMode(e)
  if (cur === 'cardio') return
  const next = cur === 'time' ? 'reps' : 'time'
  e.target = { ...defaultConfig(e.id, next), ...(e.target || {}), mode: next }
  e.sets = e.sets.map(s => next === 'time'
    ? { sec: e.target.sec || 45, w: e.target.weight || 0, done: false, ...(s.wu ? { wu: true } : {}) }
    : { w: e.target.weight || 0, r: e.target.reps || 10, done: false, ...(s.wu ? { wu: true } : {}) })
})
// Flip one set. Stored as an override only when it differs from the exercise's own mode, so
// a set switched back is indistinguishable from one never touched.
const changeSetMode = (idx, i) => mutEntry(idx, e => {
  const em = entryMode(e)
  if (em === 'cardio') return
  const s = e.sets[i]
  const next = (s.mode || em) === 'time' ? 'reps' : 'time'
  const ovr = next === em ? {} : { mode: next }
  e.sets[i] = next === 'time'
    ? { ...ovr, sec: s.sec || e.target.sec || 45, w: s.w || e.target.weight || 0, done: false, ...(s.wu ? { wu: true } : {}) }
    : { ...ovr, w: s.w || e.target.weight || 0, r: s.r || e.target.reps || 10, done: false, ...(s.wu ? { wu: true } : {}) }
})
const addWeight = idx => mutEntry(idx, e => { e.weighted = true })

// Check a set off (or undo it). Rest starts after the last exercise of a round; the whole
// workout being done opens the finish prompt; a loaded exercise finishing asks for the
// working weight to carry forward, exactly as before.
function toggleSet(idx, i) {
  const S = getS(), A = S.active
  const units = supersetUnits(A.entries)
  const unit = unitOf(units, idx)
  const circ = unit.length > 1 ? circuitOf(A, A.entries[unit[0]].sg) : null
  const m = entryMode(A.entries[idx])
  let askTop = false, exJustDone = false, workoutDone = false
  upd(s => {
    const a = s.active, e = a.entries[idx]
    e.sets[i].done = !e.sets[i].done
    a.cur = idx
    if (!e.sets[i].done) return
    beep(S.sound, 1040, 0.12); vibrate(30)
    const unitDone = unit.every(ui => a.entries[ui].sets.every(x => x.done))
    workoutDone = a.entries.every(x => x.sets.every(y => y.done))
    if (workoutDone) ui().stopRest()
    else if (idx === unit[unit.length - 1] || unitDone) ui().startRest(S.restSec)
    // Finished this exercise/superset → the "current" one moves to whatever is next, so voice
    // commands and the highlight both follow.
    if (unitDone && !workoutDone) { const n = nextSetOf({ ...a, cur: (unit[unit.length - 1] + 1) % a.entries.length }); if (n) a.cur = n.idx }
    const loaded = m === 'reps' && !circ && !(isBw(cfgOf(e)) && !e.sets.some(x => x.w > 0))
    if (e.sets.every(x => x.done)) { exJustDone = true; if (loaded && !e.asked) { e.asked = true; askTop = true } }
  })
  if (askTop) topWeightSheet(idx)
  else if (workoutDone) workoutCompleteSheet()
  else if (exJustDone && m === 'cardio') ui().toast(t('Cardio logged'))
  else if (exJustDone && m === 'time') ui().toast(t('Hold logged'))
}

// A timed set is held, not typed: the work timer (with its get-ready countdown) records what
// was actually held, then checks the set off through the normal path.
function startTimed(idx, i) {
  const e = getS().active.entries[idx]
  ui().startWork(e.sets[i].sec || 45, exOr(e.id).n, elapsed => {
    mutEntry(idx, en => { en.sets[i].sec = elapsed })
    if (!getS().active.entries[idx].sets[i].done) toggleSet(idx, i)
  })
}

/* ---------- swap, with the choice to make it stick ---------- */
// Which routine exercise a session entry came from: the n-th occurrence of its exercise id in
// the routine, n being how many earlier entries share that id. Sessions are built from the
// routine in order, so this holds even after exercises were added or swapped elsewhere.
function routineSlot(r, entries, idx) {
  const id = entries[idx].id
  const n = entries.slice(0, idx).filter(e => e.id === id).length
  let seen = -1
  return r.ex.findIndex(x => x.id === id && ++seen === n)
}
// What a swapped-in exercise starts from — the same seed the routine editor's swap uses: the
// new movement's own defaults (bodyweight flag, mode), keeping the old slot's sets, rep or hold
// target (when the mode matches), warm-ups and progression settings. Weight is left to the new
// exercise's own history — 60 kg of barbell bench says nothing about dumbbells.
function swapCfg(old, oldId, newId) {
  const d = defaultConfig(newId)
  const om = modeOf({ ...old, id: oldId })
  return {
    ...d, sets: old.sets ?? d.sets,
    ...(om === d.mode && d.mode === 'reps' && old.reps ? { reps: old.reps } : {}),
    ...(om === d.mode && d.mode === 'time' && old.sec ? { sec: old.sec } : {}),
    ...(old.warmups ? { warmups: old.warmups } : {}), ...(old.prog ? { prog: old.prog } : {}), ...(old.inc ? { inc: old.inc } : {})
  }
}
function swapExercise(idx) {
  const logged = getS().active.entries[idx].sets.filter(x => x.done).length
  if (logged) return confirmSheet({
    title: t('Swap {0}?', exOr(getS().active.entries[idx].id).n), message: t('The {0} sets you’ve logged for it will be replaced.', logged),
    confirmText: t('Swap'), danger: true, onConfirm: () => pickSwap(idx)
  })
  pickSwap(idx)
}
function pickSwap(idx) {
  const picker = exercisePicker(newEx => {
    picker.close()
    const S = getS(), A = S.active
    const r = S.routines.find(x => x.id === A.routineId)
    const k = r ? routineSlot(r, A.entries, idx) : -1
    const oldName = exOr(A.entries[idx].id).n
    const apply = toRoutine => upd(s => {
      const e = s.active.entries[idx]
      e.target = swapCfg(e.target || {}, e.id, newEx.id)
      e.id = newEx.id
      delete e.weighted
      const full = cfgOf(e)
      const routine = s.routines.find(x => x.id === s.active.routineId)
      e.plan = nextPrescription(s, full, routine)
      e.sets = applyPrescription(buildSets(s, full), e.plan)
      delete e.asked
      if (toRoutine && routine && routine.ex[k]) {
        const o = routine.ex[k]
        routine.ex[k] = { id: newEx.id, ...(o.sg ? { sg: o.sg } : {}), ...swapCfg(o, o.id, newEx.id) }
        routine.ts = Date.now()
      }
    })
    if (k < 0) return apply(false)
    ui().openSheet(close => <div style={{ textAlign: 'center', padding: '4px 0' }}>
      <h3 className="capitalize" style={{ marginBottom: 6 }}>{oldName} → {newEx.n}</h3>
      <div className="muted" style={{ marginBottom: 18 }}>{t('Keep this swap for next time too?')}</div>
      <Button variant="primary" onClick={() => { close(); apply(true); ui().toast(t('{0} updated', r.name)) }}>{t('Update {0}', r.name)}</Button>
      <div style={{ height: 8 }} />
      <Button onClick={() => { close(); apply(false) }}>{t('Just today')}</Button>
    </div>, { kind: 'center' })
  })
}

function removeExercise(idx) {
  const e = getS().active.entries[idx]
  confirmSheet({
    title: t('Remove {0}?', exOr(e.id).n), message: t('Only from today’s workout — your routine stays the same.'), confirmText: t('Remove'), danger: true,
    onConfirm: () => upd(s => { s.active.entries.splice(idx, 1); s.active.cur = Math.max(0, Math.min(s.active.cur, s.active.entries.length - 1)) })
  })
}

/* ---------- how a set reads in the list ---------- */
function SetText({ e, s, unit }) {
  const m = setModeOf(e, s)
  if (m === 'cardio') return <span className="v">{fmtNum(s.min || 0)} min<small>{fmtNum(s.speed || 0)} km/h</small></span>
  if (m === 'time') return <span className="v">{fmtHold(s.sec)}{s.w > 0 && <small>{(isBw(cfgOf(e)) ? '+' : '') + fmtNum(s.w)} {unit}</small>}</span>
  const eff = s.rir != null ? 'RIR ' + fmtNum(s.rir) : s.rpe != null ? 'RPE ' + fmtNum(s.rpe) : null
  const body = !showsWeight(e) ? t('{0} reps', s.r || 0)
    : (isBw(cfgOf(e)) ? '+' : '') + fmtNum(s.w || 0) + ' ' + unit + ' × ' + (s.r || 0)
  return <span className="v">{body}{isPerSide(cfgOf(e)) && <small>{t('{0} per side', fmtNum(sideReps(s.r)))}</small>}{eff && <small>{eff}</small>}</span>
}

function SetRow({ idx, i, isNext }) {
  const S = useStore(s => s.S)
  const e = S.active.entries[idx]
  const s = e.sets[i]
  const timed = setModeOf(e, s) === 'time'
  const working = useUI(x => x.work)
  const badge = s.wu ? <span className="n wu">W</span> : <span className={'n' + (s.skip ? ' skip' : '')}>{setNumber(e, i)}</span>
  const stop = ev => ev.stopPropagation()
  return <div id={`set-${idx}-${i}`} className={'wset' + (s.done ? ' done' : '') + (isNext ? ' next' : '')} onClick={() => setSheet(idx, i)}>
    {badge}
    <SetText e={e} s={s} unit={S.unit} />
    <span onClick={stop} className="wset-act">
      {s.done ? <button className="ck on" aria-label={t('Undo')} onClick={() => toggleSet(idx, i)}><Icon name="check" /></button>
        : timed ? <button className="playbtn" aria-label={t('Start hold')} disabled={!!working} onClick={() => startTimed(idx, i)}><Icon name="play" /></button>
          : isNext ? <button className="logbtn" onClick={() => toggleSet(idx, i)}>{t('Log')}</button>
            : <button className="ck" aria-label={t('Log set')} onClick={() => toggleSet(idx, i)} />}
    </span>
  </div>
}

function ExerciseCard({ idx, next, inGroup }) {
  const S = useStore(s => s.S)
  const e = S.active.entries[idx]
  const ex = exOr(e.id)
  const [open, setOpen] = useState(false)
  const doneN = e.sets.filter(s => s.done).length
  const allDone = e.sets.length > 0 && doneN === e.sets.length
  const collapsed = allDone && !open
  const last = lastEntryFor(S, e.id)
  const plan = e.plan
  const lastLine = last && last.sets.filter(s => !s.wu).map(s => {
    const m = setModeOf({ ...e, target: last.target || e.target }, s)
    return m === 'time' ? fmtHold(s.sec) : m === 'cardio' ? fmtNum(s.min || 0) + ' min' : (s.w > 0 ? fmtNum(s.w) + '×' : '') + (s.r || 0)
  }).join(', ')
  return <div className={'wex' + (inGroup ? ' grouped' : '') + (collapsed ? ' collapsed' : '')}>
    <div className="wex-h" onClick={() => allDone && setOpen(!open)}>
      <div className="grow">
        <div className="wex-n">{ex.n}{allDone && <Icon name="check" className="wex-ok" />}</div>
        {collapsed ? <div className="wex-sub">{e.sets.filter(s => s.done).map(s => setModeOf(e, s) === 'time' ? fmtHold(s.sec) : setModeOf(e, s) === 'cardio' ? fmtNum(s.min) + ' min' : (showsWeight(e) ? fmtNum(s.w || 0) + '×' : '') + (s.r || 0)).join(', ')}</div>
          : <div className="wex-sub">
            {lastLine ? t('Last: {0}', lastLine) : t('First time')}
            {plan && plan.why && plan.kind !== 'off' && <span className={'wex-plan' + (plan.kind === 'deload' ? ' warn' : '')}> · {t(...plan.why)}</span>}
          </div>}
      </div>
      <span className="wex-c">{doneN}/{e.sets.length}</span>
      <button className="wex-more" aria-label={t('Exercise options')} onClick={ev => { ev.stopPropagation(); exerciseMenu(idx) }}>•••</button>
    </div>
    {!collapsed && <>
      <div className="wsets">
        {e.sets.map((s, i) => <SetRow key={i} idx={idx} i={i} isNext={!!next && next.idx === idx && next.i === i} />)}
      </div>
      {!inGroup && <button className="wadd" onClick={() => addSetTo([idx])}><Icon name="plus" />{t('Add set')}</button>}
    </>}
  </div>
}

function GroupCard({ unit, next }) {
  const A = useStore(s => s.S.active)
  const circ = circuitOf(A, A.entries[unit[0]].sg)
  const round = circ ? Math.min(circ.rounds, circuitRound(A.entries, unit)) : 0
  const allDone = unit.every(i => A.entries[i].sets.every(s => s.done))
  return <div className="wgroup">
    <div className="wgroup-h"><Icon name={circ ? 'reset' : 'link'} />{circ
      ? (circ.label ? circ.label + ' · ' : '') + t('Circuit · round {0} / {1}', round, circ.rounds)
      : t('Superset · back-to-back, rest after the round')}</div>
    {unit.map(idx => <ExerciseCard key={idx} idx={idx} next={next} inGroup />)}
    {!allDone && <div className="wgroup-f">
      {circ ? <>
        <button className="wadd" onClick={() => bumpRound(unit, 1)}><Icon name="plus" />{t('Round')}</button>
        <button className="wadd" disabled={circ.rounds <= 1} onClick={() => bumpRound(unit, -1)}><Icon name="minus" />{t('Round')}</button>
        <button className="wadd" style={{ marginLeft: 'auto' }} onClick={() => swapCircuit(unit)}><Icon name="reset" />{t('Swap circuit')}</button>
      </> : <button className="wadd" onClick={() => addSetTo(unit)}><Icon name="plus" />{t('Add a set to each')}</button>}
    </div>}
  </div>
}

// A circuit adds/drops a whole round — one set on every member — and keeps its round count in
// step so the "round k / n" header stays right.
const bumpRound = (unit, dir) => upd(s => {
  const ents = s.active.entries
  unit.forEach(i => { if (dir > 0) pushSet(ents[i]); else if (ents[i].sets.length > 1) ents[i].sets.pop() })
  const sg = ents[unit[0]]?.sg
  if (s.active.cg?.[sg]) s.active.cg[sg].rounds = Math.max(1, s.active.cg[sg].rounds + dir)
})
// Replace a whole circuit with a saved one — same slot range and sg, fresh rows, no progression.
function swapCircuit(unit) {
  const A = getS().active
  const doIt = saved => upd(s => {
    const ents = s.active.entries
    const sg = ents[unit[0]].sg
    const built = saved.ex.map(e => {
      const full = { ...e, sets: saved.rounds, prog: 'off' }
      const plan = nextPrescription(s, full, null)
      return { id: e.id, sg, target: { ...e, sets: saved.rounds }, plan, sets: applyPrescription(buildSets(s, full), plan) }
    })
    ents.splice(unit[0], unit.length, ...built)
    s.active.cg = s.active.cg || {}
    s.active.cg[sg] = { rounds: saved.rounds, label: saved.label, cid: saved.id }
    s.active.cur = unit[0]
  })
  const open = () => circuitPickSheet(doIt, { title: t('Swap this circuit') })
  if (unit.some(i => A.entries[i].sets.some(x => x.done))) confirmSheet({ title: t('Swap this circuit?'), message: t('The sets you’ve logged in it will be replaced.'), confirmText: t('Swap'), danger: true, onConfirm: open })
  else open()
}

/* ---------- exercise options ---------- */
function exerciseMenu(idx) {
  ui().openSheet(close => {
    const A = getS().active
    const e = A.entries[idx]
    const ex = exOr(e.id)
    const m = entryMode(e)
    const go = fn => () => { close(); fn() }
    return <>
      <h3 className="capitalize" style={{ marginBottom: 12 }}>{ex.n}</h3>
      <div className="list">
        <Row icon="shuffle" title={t('Swap exercise')} onClick={go(() => swapExercise(idx))} />
        {m !== 'cardio' && <Row icon={m === 'time' ? 'dumbbell' : 'clock'} title={m === 'time' ? t('Switch to reps') : t('Switch to time')} onClick={go(() => changeMode(idx))} />}
        {m !== 'cardio' && !showsWeight(e) && <Row icon="plus" title={t('Add weight')} onClick={go(() => addWeight(idx))} />}
        <Row icon="flame" title={t('Add a warm-up set')} subtitle={t('Goes right before your next set')} onClick={go(() => addWarmupTo([idx]))} />
        <Row icon="info" title={t('Details & history')} onClick={go(() => exerciseDetailSheet(ex))} />
        <Row icon="trash" title={t('Remove from today')} danger onClick={go(() => removeExercise(idx))} />
      </div>
    </>
  })
}

/* ---------- one set, edited ---------- */
const HOLD_PRESETS = [20, 30, 45, 60, 90, 120]
function setSheet(idx, i) { ui().openSheet(close => <SetSheet idx={idx} i={i} close={close} />) }
function SetSheet({ idx, i, close }) {
  const S = useStore(s => s.S)
  const e = S.active?.entries[idx]
  const s = e?.sets[i]
  useEffect(() => { if (!s) close() }, [!s])
  if (!s) return null
  const ex = exOr(e.id)
  const cfg = cfgOf(e)
  const m = setModeOf(e, s)
  const em = entryMode(e)
  const withW = showsWeight(e)
  const bw = isBw(cfg)
  const kind = effortOf(S)
  const eff = m === 'reps' ? EFFORT[kind] : null
  const set = (f, v) => setField(idx, i, f, v)
  const wLabel = bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit)
  // Last time's matching working set, so "what did I do" is answered right where you type.
  const last = lastEntryFor(S, e.id)
  const prev = !s.wu && last ? last.sets.filter(x => !x.wu)[setNumber(e, i) - 1] : null
  const prevText = prev && (setModeOf({ ...e, target: last.target || e.target }, prev) === 'time' ? fmtHold(prev.sec) + (prev.w > 0 ? ' · ' + fmtNum(prev.w) + ' ' + S.unit : '')
    : em === 'cardio' ? fmtNum(prev.min || 0) + ' min'
      : (prev.w > 0 ? fmtNum(prev.w) + ' ' + S.unit + ' × ' : '') + (prev.r || 0) + (prev.w > 0 ? '' : ' ' + t('reps')))
  const big = (label, f, step, dec) => <Stepper label={label} value={s[f] ?? 0} step={step} decimal={dec} onChange={v => set(f, v)} />
  const working = useUI.getState().work
  return <div className="setsheet">
    <div className="sh-h">
      <div>
        <h3 className="capitalize">{ex.n}</h3>
        <div className="muted small">{s.wu ? t('Warm-up set') : t('Set {0} of {1}', setNumber(e, i), e.sets.filter(x => !x.wu).length)}{s.skip ? ' · ' + t('not counted') : ''}</div>
      </div>
      {s.done && <span className="tag acc">{t('Logged')}</span>}
    </div>

    {m === 'time' && <div className="hold-presets" style={{ marginTop: 16 }}>
      {HOLD_PRESETS.map(p => <button key={p} className={'chip nocap' + (p === s.sec ? ' on' : '')} onClick={() => set('sec', p)}>{fmtHold(p)}</button>)}
    </div>}
    <div className="cfgrow setbig" style={{ marginTop: 16 }}>
      {m === 'cardio' ? <>{big(t('Duration (min)'), 'min', 1, false)}{big(t('Speed (km/h)'), 'speed', 0.5, true)}</>
        : m === 'time' ? <>{big(t('Seconds'), 'sec', 5, false)}{withW && big(wLabel, 'w', 2.5, true)}</>
          : <>{withW && big(wLabel, 'w', 2.5, true)}{big(t('Reps'), 'r', repStep(cfg), false)}</>}
    </div>
    {eff && <div className="cfgrow setbig" style={{ marginTop: 10 }}>
      <div className="stp-w"><span className="stp-l">{t(eff.hd)}</span><div className="stp">
        <button aria-label="Decrease" onClick={() => set(eff.f, stepEffort(kind, s[eff.f], -1))}><Icon name="minus" /></button>
        <span className="val"><NumberField decimal nullable value={s[eff.f] ?? ''} onChange={v => set(eff.f, capEffort(kind, v))} /></span>
        <button aria-label="Increase" onClick={() => set(eff.f, stepEffort(kind, s[eff.f], 1))}><Icon name="plus" /></button>
      </div></div>
    </div>}
    {m !== 'cardio' && !withW && <button className="wadd" style={{ marginTop: 6 }} onClick={() => addWeight(idx)}><Icon name="plus" />{t('Add weight')}</button>}
    {prevText && <div className="setsheet-prev">{t('Last time:')} <b>{prevText}</b></div>}

    <div style={{ height: 16 }} />
    {s.done ? <>
      <Button variant="primary" onClick={close}>{t('Done')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => toggleSet(idx, i)}>{t('Mark as not done')}</Button>
    </> : m === 'time' ? <>
      <Button variant="primary" icon="play" disabled={!!working} onClick={() => { close(); startTimed(idx, i) }}>{t('Start hold')}</Button>
      <div style={{ height: 8 }} />
      <Button variant="ghost" className="dim" onClick={() => { close(); toggleSet(idx, i) }}>{t('Log without timer')}</Button>
    </> : <Button variant="primary" icon="check" onClick={() => { close(); toggleSet(idx, i) }}>{t('Log set')}</Button>}

    <div className="setsheet-opts">
      <button className={s.wu ? 'on' : ''} onClick={() => setFlag(idx, i, s.wu ? null : 'wu')}><Icon name="flame" />{t('Warm-up')}</button>
      <button className={s.skip ? 'on' : ''} onClick={() => setFlag(idx, i, s.skip ? null : 'skip')}><Icon name="chartLineOff" />{t('Don’t count')}</button>
      {em !== 'cardio' && <button onClick={() => changeSetMode(idx, i)}><Icon name={m === 'time' ? 'dumbbell' : 'clock'} />{m === 'time' ? t('Reps') : t('Time')}</button>}
      <button disabled={e.sets.length <= 1} onClick={() => { close(); deleteSet(idx, i) }}><Icon name="trash" />{t('Delete')}</button>
    </div>
  </div>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const A = S.active
  const units = supersetUnits(A.entries)
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)
  const next = nextSetOf(A)
  const nextKey = next ? next.idx + '-' + next.i : ''

  // Bring the set you owe into view whenever it moves on (and once on open). Not while you're
  // editing something else — only when the "next" set itself changes.
  const first = useRef(true)
  useEffect(() => {
    if (!next) return
    const el = document.getElementById('set-' + nextKey)
    if (el) el.scrollIntoView({ behavior: first.current ? 'auto' : 'smooth', block: 'center' })
    first.current = false
  }, [nextKey])

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const uix = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: uix + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  const addExercise = () => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => {
    const full = { ...cfg, id: ex.id }
    const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
    // `added` lets the finish flow offer to keep it in the routine.
    s.active.entries.push({ id: ex.id, target: { ...cfg }, plan, sets: applyPrescription(buildSets(s, full), plan), added: true })
    s.active.cur = s.active.entries.length - 1
  }, true), null, S.routines.find(r => r.id === A.routineId)))

  const allDone = A.entries.length > 0 && done === total
  return <div className="narrow wlist">
    <div className="wstick"><div className="wtop">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); ui().stopRest(); nav('/home') } })}><Icon name="xmark" /></button>
      <div className="grow">
        <div className="wtop-n">{A.name}</div>
        <div className="wtop-s"><Elapsed start={A.start} /> · {t('{0} of {1} sets', done, total)}</div>
      </div>
      <button className={'wfinish' + (allDone ? ' on' : '')} onClick={finishWorkout}>{t('Finish')}</button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div></div>

    {A.entries.length ? units.map(u => u.length > 1
      ? <GroupCard key={u.join('-')} unit={u} next={next} />
      : <ExerciseCard key={u[0]} idx={u[0]} next={next} />)
      : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    <div style={{ height: 14 }} />
    <Button icon="plus" onClick={addExercise}>{t('Add exercise')}</Button>
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
