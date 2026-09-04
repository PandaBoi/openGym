import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { effectiveRoutine, lastEntryFor, bestWeightFor, buildSets, setsDoneActive, supersetUnits, unitOf, setLabel, modeOf, isBw, isPerSide, sideReps, repStep, EFFORT, effortOf, stepEffort, capEffort, circuitOf, circuitRound } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, exCount, DAYN } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'
import Media from '../components/Media.jsx'
import { startFlow, exercisePicker, exConfigSheet, exerciseDetailSheet, topWeightSheet, finishWorkout, workoutCompleteSheet, confirmSheet, circuitPickSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Check, NumberField } from '../components/ui.jsx'
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

/* ---------- one exercise block (reps: weight×reps · time: a held duration · cardio: duration+speed) ----------
   `focus` mode logs one set at a time: finished sets collapse to a read-only strip, the set
   in front of you gets big fields and a full-width "Log set" button. "Show all sets" flips
   back to the full grid for anyone who plans the whole exercise up front. */
function ExerciseBlock({ entryIdx, compact, focus, onToggle, onField, onAddSet, onRemoveSet, onAddWarmup, onStartTimed, onSwap, onWarmup, hideSetButtons, removeDisabled, sharedSet }) {
  const S = useStore(s => s.S)
  const working = useUI(s => s.work)
  const [showAll, setShowAll] = useState(false)
  const entry = S.active.entries[entryIdx]
  const ex = exOr(entry.id)
  const mode = modeOf({ ...(entry.target || {}), id: entry.id })
  const cardio = mode === 'cardio'
  const timed = mode === 'time'
  const last = lastEntryFor(S, entry.id)
  // The same number the "confirm your working weight" sheet calls your best, so the two
  // never disagree inside one session: heaviest logged set, or the working weight you kept.
  const best = cardio ? 0 : Math.max(bestWeightFor(S, entry.id), (S.exWeights[entry.id] || {}).w || 0)
  // What the progression policy decided for this session, and why (issue #17). Computed when
  // the session was built so the reason matches the numbers already in the rows.
  const plan = entry.plan
  // A bodyweight set has no weight to type, so the column is not there (issue #32) — one
  // stepper instead of two, which is the whole point of the flag. Adding a belt weight in the
  // config brings it back, now labelled as the addition it is.
  const cfg = { ...(entry.target || {}), id: entry.id }
  const bw = !cardio && isBw(cfg)
  const added = bw && entry.sets.some(s => s.w > 0)
  const loadCol = { f: 'w', step: 2.5, dec: true, hd: bw ? t('Added ({0})', S.unit) : t('Weight ({0})', S.unit) }
  // The reps column is the total in every mode, unilateral included — the stepper walks in
  // twos there so the number you land on is one you can actually split evenly.
  const repCol = { f: 'r', step: repStep(cfg), dec: false, hd: t('Reps') }
  const col1 = cardio ? { f: 'min', step: 1, dec: false, hd: t('Duration (min)') }
    : timed ? { f: 'sec', step: 5, dec: false, hd: t('Seconds') }
      : (bw && !added) ? repCol : loadCol
  const col2 = cardio ? { f: 'speed', step: 0.5, dec: true, hd: t('Speed (km/h)') }
    : timed ? ((bw && !added) ? null : loadCol)
      : (bw && !added) ? null : repCol
  // Effort (RIR or RPE, whichever the profile logs) only makes sense for weighted rep sets,
  // not cardio/timed holds, and is opt-in since it adds a third stepper to every row. `opt`
  // because an unlogged effort is not the same as 0 — RIR 0 says the set went to failure.
  const kind = effortOf(S)
  const eff = EFFORT[kind]
  const col3 = mode === 'reps' && eff ? { ...eff, eff: kind, dec: true, opt: true, hd: t(eff.hd) } : null
  // The effort column walks its own scale — see stepEffort. Weight and reps step up from 0
  // with no ceiling, as they always did.
  const bump = (s, i, col, dir) => {
    if (col.eff) return onField(i, col.f, stepEffort(col.eff, s[col.f], dir))
    onField(i, col.f, Math.max(0, Math.round(((s[col.f] || 0) + dir * col.step) * 100) / 100))
  }
  // Uses the shared stepper markup so a set row picks up the same control styling
  // as every other +/- field in the app.
  const cell = (s, i, col, cls) => (
    <div className={'stp ' + cls}>
      <button aria-label="Decrease" onClick={() => bump(s, i, col, -1)}><Icon name="minus" /></button>
      {/* a typed effort is capped — there is no RPE 12, and 12 reps in reserve is a warm-up */}
      <span className="val"><NumberField decimal={col.dec} nullable={col.opt} value={s[col.f] ?? ''}
        onChange={v => onField(i, col.f, col.eff ? capEffort(col.eff, v) : v)} /></span>
      <button aria-label="Increase" onClick={() => bump(s, i, col, 1)}><Icon name="plus" /></button>
    </div>
  )
  // Working-set numbering skips warm-ups: 1, 2, 3… starts after them.
  const wuBefore = i => entry.sets.slice(0, i).filter(x => x.wu).length
  const setNum = i => i + 1 - wuBefore(i)
  const workCount = entry.sets.length - entry.sets.filter(s => s.wu).length
  // One control for warm-up/working, reused everywhere a set shows its number — the full
  // grid, the done-list, and the current-set header. Same gesture in all three: tap the
  // round badge to flip it. A flame replaces the number while it's a warm-up, so the state
  // reads the same way no matter which view you're in.
  const WuBadge = ({ i, cls }) => {
    const wu = !!entry.sets[i].wu
    const label = wu ? t('Warm-up — tap to make it a working set') : t('Tap to mark as a warm-up')
    const content = wu ? <Icon name="flame" /> : setNum(i)
    return onWarmup
      ? <button className={'n wu-badge' + (wu ? ' wu' : '') + (cls ? ' ' + cls : '')} title={label} aria-label={label}
        onClick={ev => { ev.stopPropagation(); onWarmup(i, !wu) }}>{content}</button>
      : <div className={'n' + (wu ? ' wu' : '') + (cls ? ' ' + cls : '')}>{content}</div>
  }
  return <>
    <Media ex={ex} key={entry.id} compact={compact} minimizable />
    <div className="row between" style={{ marginBottom: 6 }}>
      <div style={{ fontSize: compact ? 17 : 20, fontWeight: 600, letterSpacing: '-.02em', textTransform: 'capitalize', lineHeight: 1.2 }}>{ex.n}</div>
      <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
        {onSwap && <button className="iconbtn" aria-label={t('Swap exercise')} onClick={onSwap}><Icon name="shuffle" /></button>}
        <button className="iconbtn" aria-label={t('Details')} onClick={() => exerciseDetailSheet(ex)}><Icon name="info" /></button>
      </div>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
      {cardio && <span className="tag acc"><Icon name="figureRun" />{t('Cardio')}</span>}
      {/* You log the total; this is the split, so the set in front of you is unambiguous
          without the rep count having to mean two different things (issue #31). */}
      {!cardio && !timed && isPerSide(cfg) && <span className="tag acc nocap"><Icon name="shuffle" />{t('{0} per side', fmtNum(sideReps(entry.sets.find(s => !s.done)?.r ?? entry.sets[0]?.r)))}</span>}
      {(ex.tg || ex.bp) && <span className="tag">{t(ex.tg || ex.bp)}</span>}
      {ex.eq && <span className="tag">{t(ex.eq)}</span>}
      {best > 0 && <span className="tag nocap">{t('Best:')} {fmtNum(best)} {S.unit}</span>}
    </div>
    {last && <div className="small dim" style={{ marginBottom: 4 }}>{t('Last time')} ({fmtDate(last.d)}): {last.sets.map(s => setLabel(entry.id, s, last.target)).join(', ')}</div>}
    {plan && plan.why && plan.kind !== 'off' && <div className={'progline' + (plan.kind === 'deload' ? ' warn' : '')}>
      <Icon name={plan.kind === 'up' ? 'arrowUp' : plan.kind === 'deload' ? 'arrowDown' : 'lightbulb'} />
      <span>{t(...plan.why)}</span>
    </div>}
    {onWarmup && !entry.sets.some(s => s.wu) && <div className="dim small" style={{ margin: '2px 2px 6px' }}>{t('Tap a set’s number to mark it a warm-up — it won’t count toward progression.')}</div>}
    <div className="card" style={{ marginTop: 10, marginBottom: 0 }}>
      {focus && !showAll ? (() => {
        const curI = entry.sets.findIndex(s => !s.done)
        const doneCount = entry.sets.filter(s => s.done).length
        const s = curI === -1 ? null : entry.sets[curI]
        return <>
          {doneCount > 0 && <div className="setdone-list">
            {entry.sets.map((x, i) => x.done && (
              <div key={i} className={'setdone' + (x.wu ? ' wu' : '')}>
                <WuBadge i={i} />
                <button className="lb-btn" onClick={() => onToggle(i)} title={t('Undo')}>
                  <span className="lb">{setLabel(entry.id, x, entry.target)}</span>
                  <Icon name="check" />
                </button>
              </div>
            ))}
          </div>}
          {s ? <>
            <div className="setnow-hd">
              <WuBadge i={curI} cls="setnow-badge" />
              {s.wu ? t('Warm-up set') : t('Set {0} of {1}', setNum(curI), workCount)}
            </div>
            <div className="cfgrow setbig">
              <div className="stp-w"><span className="stp-l">{col1.hd}</span>{cell(s, curI, col1, 'w')}</div>
              {col2 && <div className="stp-w"><span className="stp-l">{col2.hd}</span>{cell(s, curI, col2, 'r')}</div>}
            </div>
            {col3 && <div className="cfgrow setbig" style={{ marginTop: 10 }}>
              <div className="stp-w"><span className="stp-l">{col3.hd}</span>{cell(s, curI, col3, 'eff')}</div>
            </div>}
            <div style={{ height: 12 }} />
            {timed
              ? <Button variant="primary" icon="play" disabled={!!working} onClick={() => onStartTimed(curI)}>{t('Start hold ({0}s)', s.sec || 45)}</Button>
              : <Button variant="primary" icon="check" onClick={() => onToggle(curI)}>{t('Log set')}</Button>}
          </> : <div className="setnow-hd" style={{ padding: '10px 0 2px' }}>{t('All sets done.')}</div>}
          <div style={{ height: 10 }} />
          <div className="row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
            {!hideSetButtons && <Button size="sm" icon="minus" disabled={removeDisabled != null ? removeDisabled : entry.sets.length <= 1} title={sharedSet ? t('Removes a set from every exercise in this superset') : undefined} onClick={onRemoveSet}>{t('Remove set')}</Button>}
            {!hideSetButtons && <Button size="sm" icon="plus" title={sharedSet ? t('Adds a set to every exercise in this superset') : undefined} onClick={onAddSet}>{t('Add set')}</Button>}
            {!hideSetButtons && onAddWarmup && <Button size="sm" variant="ghost" icon="flame" title={sharedSet ? t('Adds a warm-up set to every exercise in this superset — next up') : t('Slots in right before your next set — doesn’t count toward progression')} onClick={onAddWarmup}>{t('Warm-up')}</Button>}
            <Button size="sm" variant="ghost" className="dim" style={{ marginLeft: 'auto' }} onClick={() => setShowAll(true)}>{t('All sets')}</Button>
          </div>
        </>
      })() : <>
        {/* the header carries the same eff3 sizing as the rows, or the labels drift off their columns */}
        <div className={'sethead' + (col3 ? ' eff3' : '')}><span className="n-sp" /><span className="w-sp">{col1.hd}</span>{col2 && <span className="r-sp">{col2.hd}</span>}{col3 && <span className="eff-sp">{col3.hd}</span>}{timed && <span className="ck-sp" />}<span className="ck-sp" /></div>
        {entry.sets.map((s, i) => <div key={i} className={'setrow' + (s.done ? ' done' : '') + (s.wu ? ' wu' : '') + (col3 ? ' eff3' : '')}>
          <WuBadge i={i} />
          {cell(s, i, col1, 'w')}
          {col2 && cell(s, i, col2, 'r')}
          {col3 && cell(s, i, col3, 'eff')}
          {/* A timed set is started, not typed: the timer counts the hold down and checks the
              set off itself. The checkbox stays for anyone who timed it on their own watch. */}
          {timed && <button className="setgo" aria-label={t('Start set')} disabled={s.done || !!working}
            onClick={() => onStartTimed(i)}><Icon name="play" /></button>}
          <Check checked={s.done} onChange={() => onToggle(i)} />
        </div>)}
        <div style={{ height: 8 }} />
        <div className="row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
          {!hideSetButtons && <Button size="sm" icon="minus" disabled={removeDisabled != null ? removeDisabled : entry.sets.length <= 1} title={sharedSet ? t('Removes a set from every exercise in this superset') : undefined} onClick={onRemoveSet}>{t('Remove set')}</Button>}
          {!hideSetButtons && <Button size="sm" icon="plus" title={sharedSet ? t('Adds a set to every exercise in this superset') : undefined} onClick={onAddSet}>{t('Add set')}</Button>}
          {!hideSetButtons && onAddWarmup && <Button size="sm" variant="ghost" icon="flame" title={sharedSet ? t('Adds a warm-up set to every exercise in this superset — next up') : t('Slots in right before your next set — doesn’t count toward progression')} onClick={onAddWarmup}>{t('Warm-up')}</Button>}
          {focus && <Button size="sm" variant="ghost" className="dim" style={{ marginLeft: 'auto' }} onClick={() => setShowAll(false)}>{t('Current set')}</Button>}
        </div>
      </>}
    </div>
  </>
}

/* ---------- active workout ---------- */
function ActiveWorkout() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { startRest, stopRest } = useUI()
  const A = S.active
  const perSet = S.setView !== 'full'   // Settings › During a workout › Set entry
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, Math.max(0, A.entries.length - 1))
  const unit = A.entries.length ? unitOf(units, cur) : []
  const unitIdx = units.findIndex(u => u === unit)
  const isSuperset = unit.length > 1
  const circ = isSuperset ? circuitOf(A, A.entries[unit[0]].sg) : null
  const round = circ ? Math.min(circ.rounds, circuitRound(A.entries, unit)) : 0
  // Superset / circuit is a pager: one exercise on screen at a time. `activeK` is the one you
  // owe the current round's set (fewest completed sets, earliest in the group); logging a set
  // moves it on. A tapped pill (`pickK`) wins until `activeK` advances past it.
  const donePerMember = unit.map(i => A.entries[i].sets.filter(s => s.done).length)
  const activeK = isSuperset ? Math.max(0, donePerMember.findIndex(c => c === Math.min(...donePerMember))) : 0
  const [pickK, setPickK] = useState(null)
  useEffect(() => { setPickK(null) }, [activeK, unitIdx])
  const shownK = pickK != null && pickK < unit.length ? pickK : activeK

  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const done = setsDoneActive(A)

  const mutEntry = (idx, fn) => update(s => { fn(s.active.entries[idx]) }, true)
  // Clearing an optional field drops the key rather than storing null, so a set only carries
  // what was actually logged — in the session, in history and in a backup.
  const setField = (idx, i, field, v) => mutEntry(idx, e => {
    if (v == null) delete e.sets[i][field]; else e.sets[i][field] = v
  })
  const modeAt = idx => modeOf({ ...(A.entries[idx].target || {}), id: A.entries[idx].id })
  const pushSet = e => {
    const l = e.sets[e.sets.length - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target.min || 20), speed: l ? l.speed : (e.target.speed || 8), done: false })
    else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target.sec || 45), w: l ? (l.w || 0) : (e.target.weight || 0), done: false })
    else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : e.target.reps, done: false })
  }
  const popSet = e => { if (e.sets.length > 1) e.sets.pop() }
  const addSet = idx => mutEntry(idx, pushSet)
  const removeSet = idx => mutEntry(idx, popSet)
  // In a plain superset, a set added or removed applies to every member at once — they're
  // meant to move together, and letting one drift to a different set count than the rest
  // is what circuits already prevent structurally (bumpRound). Not for circuits: their
  // round buttons are the equivalent control and stay separate.
  const addSetUnit = idxs => update(s => { idxs.forEach(i => pushSet(s.active.entries[i])) }, true)
  const removeSetUnit = idxs => update(s => { idxs.forEach(i => popSet(s.active.entries[i])) }, true)
  // Flag a row as a warm-up (or clear it) by hand — progression skips warm-ups, so this is
  // how you keep a light opener out of the stall/deload maths on an ad-hoc day.
  const markWarmup = (idx, i, v) => mutEntry(idx, e => { if (v) e.sets[i].wu = true; else delete e.sets[i].wu })
  // Slot in a fresh warm-up set mid-session — not just relabel one that's already there.
  // Lands right before the next set you owe (not at the end), seeded from that neighbour so
  // it doesn't show up at 0/0 and tagged wu straight away so it never touches progression.
  const insertWarmup = e => {
    const at = e.sets.findIndex(s => !s.done)
    const idx = at === -1 ? e.sets.length : at
    const near = e.sets[idx] || e.sets[idx - 1]
    const m = modeOf({ ...(e.target || {}), id: e.id })
    const row = m === 'cardio' ? { min: near ? near.min : (e.target.min || 20), speed: near ? near.speed : (e.target.speed || 8), done: false }
      : m === 'time' ? { sec: near ? near.sec : (e.target.sec || 45), w: near ? (near.w || 0) : (e.target.weight || 0), done: false }
        : { w: near ? near.w : 0, r: near ? near.r : e.target.reps, done: false }
    row.wu = true
    e.sets.splice(idx, 0, row)
  }
  const addWarmup = idx => mutEntry(idx, insertWarmup)
  const addWarmupUnit = idxs => update(s => { idxs.forEach(i => insertWarmup(s.active.entries[i])) }, true)
  // A circuit adds/drops a whole round — one set on every member — and keeps its round count
  // in step so the "Round k / n" header stays right.
  const bumpRound = dir => update(s => {
    const ents = s.active.entries
    const u = supersetUnits(ents).find(x => x.includes(Math.min(s.active.cur, ents.length - 1))) || []
    u.forEach(i => {
      const e = ents[i]
      if (dir > 0) {
        const l = e.sets[e.sets.length - 1]
        const m = modeOf({ ...(e.target || {}), id: e.id })
        if (m === 'cardio') e.sets.push({ min: l ? l.min : (e.target?.min || 20), speed: l ? l.speed : (e.target?.speed || 8), done: false })
        else if (m === 'time') e.sets.push({ sec: l ? l.sec : (e.target?.sec || 45), w: l ? (l.w || 0) : (e.target?.weight || 0), done: false })
        else e.sets.push({ w: l ? l.w : 0, r: l ? l.r : (e.target?.reps || 8), done: false })
      } else if (e.sets.length > 1) e.sets.pop()
    })
    const sg = ents[u[0]]?.sg
    if (s.active.cg?.[sg]) s.active.cg[sg].rounds = Math.max(1, s.active.cg[sg].rounds + dir)
  }, true)

  // Replace an exercise mid-session — picked the wrong machine, it's taken, form's off.
  // Keeps the slot and its superset link; rebuilds the prescription and rows for the new
  // movement, exactly as the voice "swap" does.
  const swapEntry = idx => exercisePicker(newEx => update(s => {
    const e = s.active.entries[idx]
    e.id = newEx.id
    const full = { ...(e.target || {}), id: newEx.id }
    const routine = s.routines.find(r => r.id === s.active.routineId)
    e.plan = nextPrescription(s, full, routine)
    e.sets = applyPrescription(buildSets(s, full), e.plan)
    delete e.asked
  }, true))

  // Replace the whole current circuit with a saved one — same slot range and sg, fresh rows,
  // no progression (it's a finisher). Confirms first if any of its sets are already logged.
  const swapCircuitLive = () => {
    const doIt = saved => update(s => {
      const ents = s.active.entries
      const u = supersetUnits(ents).find(x => x.includes(Math.min(s.active.cur, ents.length - 1))) || []
      if (!u.length) return
      const sg = ents[u[0]].sg
      const at = u[0]
      const built = saved.ex.map(e => {
        const full = { ...e, sets: saved.rounds, prog: 'off' }
        const plan = nextPrescription(s, full, null)
        return { id: e.id, sg, target: { ...e, sets: saved.rounds }, plan, sets: applyPrescription(buildSets(s, full), plan) }
      })
      ents.splice(at, u.length, ...built)
      s.active.cg = s.active.cg || {}
      s.active.cg[sg] = { rounds: saved.rounds, label: saved.label, cid: saved.id }
      s.active.cur = at
    }, true)
    const open = () => circuitPickSheet(doIt, { title: t('Swap this circuit') })
    if (unit.some(i => A.entries[i].sets.some(x => x.done))) {
      confirmSheet({ title: t('Swap this circuit?'), message: t('The sets you’ve logged in it will be replaced.'), confirmText: t('Swap'), danger: true, onConfirm: open })
    } else open()
  }

  // A timed set is held, not typed. The work timer records what was actually held — an early
  // finish logs 0:38 of a 0:45 target rather than crediting the full prescription — and then
  // checks the set off through the normal path, so rest, supersets and the finish prompt all
  // behave exactly as they do for a reps set.
  const startTimed = (idx, i) => {
    const e = A.entries[idx]
    useUI.getState().startWork(e.sets[i].sec || 45, exOr(e.id).n, elapsed => {
      mutEntry(idx, en => { en.sets[i].sec = elapsed })
      if (!useStore.getState().S.active.entries[idx].sets[i].done) toggle(idx, i)
    })
  }

  const toggle = (idx, i) => {
    const m = modeAt(idx)
    const cardioEntry = m === 'cardio'
    const isLastUnit = unitIdx >= units.length - 1
    let askTop = false, exJustDone = false, workoutDone = false
    mutEntry(idx, e => {
      e.sets[i].done = !e.sets[i].done
      if (e.sets[i].done) {
        beep(S.sound, 1040, 0.12); vibrate(30)
        const isLastExInUnit = idx === unit[unit.length - 1]
        const unitDone = unit.every(ui => (ui === idx ? e : A.entries[ui]).sets.every(x => x.done))
        if (isLastExInUnit && !unitDone) startRest(S.restSec)
        else if (unitDone) stopRest()
        if (unitDone && isLastUnit) workoutDone = true      // last exercise's last set → done
        // Only loaded reps training has a "working weight" worth confirming — a bodyweight
        // plank has nothing to put in that slider, and neither does a set of push-ups
        // (issue #32: the fewest taps that still record what happened).
        // A circuit is conditioning — no working weight to confirm, so skip that prompt.
        const loaded = m === 'reps' && !circ && !(isBw({ ...(e.target || {}), id: e.id }) && !e.sets.some(x => x.w > 0))
        if (e.sets.every(x => x.done)) { exJustDone = true; if (loaded && !e.asked) { e.asked = true; askTop = true } }
      }
    })
    // reps: topWeight first (it chains into the finish/continue prompt on the last unit).
    // cardio/timed or already-confirmed: go straight to the prompt.
    if (askTop) topWeightSheet(idx)
    else if (workoutDone) workoutCompleteSheet()
    else if (exJustDone && cardioEntry) useUI.getState().toast(t('Cardio logged'))
    else if (exJustDone && m === 'time') useUI.getState().toast(t('Hold logged'))
  }

  // Live-presence heartbeat so the admin dashboard can show who's training now. Signed-in only —
  // guests have no server session. Reads fresh state each tick so progress stays current.
  useEffect(() => {
    if (!useStore.getState().user) return
    let stopped = false
    const ping = active => {
      const A2 = useStore.getState().S.active
      if (!A2) return
      const u = supersetUnits(A2.entries)
      const c = Math.min(A2.cur, Math.max(0, A2.entries.length - 1))
      const ui = u.findIndex(x => x.includes(c))
      const tot = A2.entries.reduce((n, e) => n + e.sets.length, 0)
      api('/api/activity', { method: 'POST', body: JSON.stringify({
        active, name: A2.name, exIdx: ui + 1, exTotal: u.length,
        setsDone: setsDoneActive(A2), setsTotal: tot, startedAt: A2.start
      }) }).catch(() => {})
    }
    ping(true)
    const iv = setInterval(() => { if (!stopped) ping(true) }, 20000)
    return () => {
      stopped = true; clearInterval(iv)
      // best-effort "left" signal: sendBeacon survives a tab close, fetch covers in-app nav
      try { navigator.sendBeacon?.('/api/activity', new Blob([JSON.stringify({ active: false })], { type: 'application/json' })) } catch { /* */ }
      api('/api/activity', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {})
    }
  }, [])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" aria-label={t('Discard')} onClick={() => confirmSheet({ title: t('Discard workout?'), message: t('The sets you logged in this session will be lost.'), confirmText: t('Discard'), danger: true, onConfirm: () => { update(s => { s.active = null }); stopRest(); nav('/home') } })}><Icon name="xmark" /></button>
      <div style={{ textAlign: 'center' }}><div style={{ fontWeight: 600 }}>{A.name}</div><div className="sub"><Elapsed start={A.start} /> · {t('{0} sets', done + '/' + total)}</div></div>
      <button className="iconbtn" style={{ color: 'var(--acc)' }} aria-label={t('Finish')} onClick={finishWorkout}><Icon name="check" /></button>
    </div>
    <div className="wprog"><i style={{ width: (total ? done / total * 100 : 0) + '%' }} /></div>

    {A.entries.length ? <>
      <div className="muted small" style={{ marginBottom: 6 }}>{circ ? t('Circuit {0} / {1}', unitIdx + 1, units.length) : isSuperset ? t('Superset {0} / {1}', unitIdx + 1, units.length) : t('Exercise {0} / {1}', unitIdx + 1, units.length)}</div>
      {isSuperset ? (() => {
        const shown = unit[shownK]
        return <div className="ss-card">
          <div className="ss-hd"><Icon name={circ ? 'reset' : 'link'} />{circ
            ? (circ.label ? circ.label + ' · ' : '') + t('round {0} / {1} · one set of each, rest after the round', round, circ.rounds)
            : t('Superset · do these back-to-back, rest after both')}</div>
          <div className="ss-pills">
            {unit.map((idx, k) => {
              const e = A.entries[idx]
              const allDone = e.sets.length > 0 && e.sets.every(x => x.done)
              return <button key={idx} className={'ss-pill' + (k === shownK ? ' on' : '') + (allDone ? ' done' : '')} onClick={() => setPickK(k)}>
                {allDone ? <Icon name="check" /> : <span className={'pdot' + (k === activeK ? ' next' : '')} />}
                <span className="pnm">{exOr(e.id).n}</span>
              </button>
            })}
          </div>
          <ExerciseBlock key={shown} entryIdx={shown} compact focus={perSet} hideSetButtons={!!circ}
            removeDisabled={unit.some(i => A.entries[i].sets.length <= 1)} sharedSet={!circ}
            onToggle={i => toggle(shown, i)} onField={(i, f, v) => setField(shown, i, f, v)} onAddSet={() => addSetUnit(unit)} onRemoveSet={() => removeSetUnit(unit)} onAddWarmup={() => addWarmupUnit(unit)} onStartTimed={i => startTimed(shown, i)} onSwap={() => swapEntry(shown)} onWarmup={(i, v) => markWarmup(shown, i, v)} />
          {circ && <div className="row" style={{ marginTop: 10 }}>
            <Button size="sm" icon="minus" disabled={circ.rounds <= 1} onClick={() => bumpRound(-1)}>{t('Remove round')}</Button>
            <Button size="sm" icon="plus" onClick={() => bumpRound(1)}>{t('Add round')}</Button>
            <Button size="sm" variant="ghost" icon="reset" style={{ marginLeft: 'auto' }} onClick={swapCircuitLive}>{t('Swap circuit')}</Button>
          </div>}
        </div>
      })() : (
        <ExerciseBlock key={cur} entryIdx={cur} focus={perSet} onToggle={i => toggle(cur, i)} onField={(i, f, v) => setField(cur, i, f, v)} onAddSet={() => addSet(cur)} onRemoveSet={() => removeSet(cur)} onAddWarmup={() => addWarmup(cur)} onStartTimed={i => startTimed(cur, i)} onSwap={() => swapEntry(cur)} onWarmup={(i, v) => markWarmup(cur, i, v)} />
      )}
    </> : <div className="empty"><div className="ico"><Icon name="shuffle" /></div>{t('Freestyle workout — add your first exercise.')}</div>}

    <div style={{ height: 12 }} />
    <div className="row">
      <Button icon="chevronLeft" disabled={unitIdx <= 0} onClick={() => update(s => { s.active.cur = units[unitIdx - 1][0] })}>{t('Prev')}</Button>
      <Button trailingIcon="chevronRight" disabled={unitIdx < 0 || unitIdx >= units.length - 1} onClick={() => update(s => { s.active.cur = units[unitIdx + 1][0] })}>{t('Next')}</Button>
    </div>
    <div style={{ height: 10 }} />
    <Button onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => {
      const full = { ...cfg, id: ex.id }
      const plan = nextPrescription(s, full, s.routines.find(r => r.id === s.active.routineId))
      s.active.entries.push({ id: ex.id, target: { ...cfg }, plan, sets: applyPrescription(buildSets(s, full), plan) })
      s.active.cur = s.active.entries.length - 1
    }), null, S.routines.find(r => r.id === A.routineId)))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    {(() => {
      const exDone = A.entries.filter(e => e.sets.length && e.sets.every(s => s.done)).length
      const allDone = A.entries.length > 0 && exDone === A.entries.length
      return <button className={allDone ? 'btn primary' : 'btn ghost dim'} onClick={finishWorkout}>
        {allDone ? t('Finish workout') : t('Finish workout early · {0} exercises', exDone + '/' + A.entries.length)}
      </button>
    })()}
    <div style={{ height: 40 }} />
  </div>
}

export default function Workout() {
  const active = useStore(s => s.S.active)
  return active ? <ActiveWorkout /> : <StartChooser />
}
