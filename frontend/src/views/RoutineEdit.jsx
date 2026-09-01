import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { supersetUnits, cleanupSg, cleanupCg, circuitOf, exLine, defaultConfig } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, SelectRow } from '../components/ui.jsx'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import BodyMap from '../components/BodyMap.jsx'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  if (!r) return null

  // Mutate the routine itself (for cg), or just its ex list (edit). Both prune orphan
  // superset ids and the circuit meta that hangs off them.
  const editR = fn => update(s => { const rr = s.routines.find(x => x.id === id); fn(rr); cleanupSg(rr.ex); cleanupCg(rr) })
  const edit = fn => editR(rr => fn(rr.ex))

  // Reorder is drag-only now (the up/down buttons are gone). Pointer events, so a finger and
  // a mouse behave the same, and the handle's touch-action:none keeps a drag from scrolling
  // the page. The dragged row tracks the pointer, the rows it passes slide out of the way,
  // and the array is spliced once — on drop.
  const rowRefs = useRef([])
  const dragData = useRef(null)
  const [drag, setDrag] = useState(null)   // { from, to, dy, h } while a drag is live
  const dragStart = (i, ev) => {
    ev.stopPropagation()
    const h = rowRefs.current[i]?.getBoundingClientRect().height || 56
    dragData.current = { from: i, to: i, startY: ev.clientY, h }
    try { ev.currentTarget.setPointerCapture(ev.pointerId) } catch { /* */ }
    setDrag({ from: i, to: i, dy: 0, h })
  }
  const dragMove = ev => {
    const d = dragData.current
    if (!d) return
    const y = ev.clientY
    let to = d.from
    for (let k = rowRefs.current.length - 1; k > d.from; k--) {
      const rc = rowRefs.current[k]?.getBoundingClientRect()
      if (rc && y > rc.top + rc.height / 2) { to = k; break }
    }
    for (let k = 0; k < d.from; k++) {
      const rc = rowRefs.current[k]?.getBoundingClientRect()
      if (rc && y < rc.top + rc.height / 2) { to = k; break }
    }
    d.to = to
    setDrag({ from: d.from, to, dy: y - d.startY, h: d.h })
  }
  const dragEnd = () => {
    const d = dragData.current
    dragData.current = null
    if (d && d.to !== d.from) edit(ex => { const [m] = ex.splice(d.from, 1); ex.splice(d.to, 0, m) })
    setDrag(null)
  }
  const rowStyle = i => {
    if (!drag) return undefined
    if (i === drag.from) return { transform: `translateY(${drag.dy}px)`, position: 'relative', zIndex: 20, opacity: 0.92, transition: 'none' }
    const { from, to, h } = drag
    let ty = 0
    if (to > from && i > from && i <= to) ty = -h
    else if (to < from && i >= to && i < from) ty = h
    return { transform: `translateY(${ty}px)`, transition: 'transform .18s ease' }
  }
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
  })
  // Turn a linked group into a circuit (fixed rounds, no progression) or back into a plain
  // superset. Members' `sets` track the round count so the one-line summary stays honest.
  const toggleCircuit = (sg, members) => editR(rr => {
    rr.cg = rr.cg || {}
    if (rr.cg[sg]) delete rr.cg[sg]
    else {
      const rounds = Math.max(2, ...members.map(m => rr.ex[m].sets || 0), 3)
      rr.cg[sg] = { rounds, label: '' }
      members.forEach(m => { rr.ex[m].sets = rounds })
    }
  })
  const setRounds = (sg, members, n) => editR(rr => {
    const rounds = Math.max(1, Math.min(12, n))
    if (!rr.cg?.[sg]) return
    rr.cg[sg].rounds = rounds
    members.forEach(m => { rr.ex[m].sets = rounds })
  })
  const setCircuitLabel = (sg, v) => editR(rr => { if (rr.cg?.[sg]) rr.cg[sg].label = v.slice(0, 24) })
  // Replace the exercise at index i in place — same slot, same superset link, same set
  // count and progression rule — then open its config so the new movement's targets can be
  // dialled in. Beats delete-then-add-then-drag.
  const swapAt = i => exercisePicker(newEx => {
    const old = r.ex[i]
    const seed = { ...defaultConfig(newEx.id), sets: old.sets, ...(old.prog ? { prog: old.prog } : {}), ...(old.inc ? { inc: old.inc } : {}) }
    exConfigSheet(newEx, seed, cfg => edit(x => { x[i] = { id: newEx.id, sg: x[i].sg, ...cfg } }), null, r)
  })

  const units = supersetUnits(r.ex)
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())
  rowRefs.current.length = r.ex.length   // drop refs for rows that no longer exist

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || t('Routine') })} />
      </div>
      <button className="iconbtn" aria-label={t('Pick an icon')} onClick={() => glyphPicker(r.emoji, g => update(s => { s.routines.find(x => x.id === id).emoji = g }))}><Icon name={glyphOf(r.emoji)} /></button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow icon="chartLine" title={t('Progression')} sheetTitle={t('Progression')}
        value={r.prog || 'linear'} onChange={v => update(s => { s.routines.find(x => x.id === id).prog = v })}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))} />
    </div>
    <div className="small dim" style={{ margin: '-10px 2px 16px' }}>
      {t('Applies to every exercise in this routine that does not set its own rule.')}
    </div>

    {r.ex.length ? <div className="list">{r.ex.map((e, i) => {
      // An unresolvable id is shown rather than skipped — hiding it left an entry you
      // could neither see nor delete, but that still turned up in the workout.
      const ex = exOr(e.id)
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      const unit = unitFirst.has(i) ? units.find(u => u[0] === i) : null
      const circ = unit && circuitOf(r, e.sg)
      return <div key={i} ref={el => { rowRefs.current[i] = el }} style={rowStyle(i)}>
        {unit && <div className="ss-label" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Icon name={circ ? 'reset' : 'link'} />{circ ? t('Circuit') : t('Superset')}
          <button className={'iconbtn' + (circ ? ' on-ss' : '')}
            style={{ marginLeft: 'auto', width: 'auto', height: 26, padding: '0 9px', borderRadius: 8, fontSize: 12, letterSpacing: 0, textTransform: 'none' }}
            onClick={() => toggleCircuit(e.sg, unit)}>{circ ? t('Circuit') : t('Make circuit')}</button>
          {circ && <div className="row" style={{ gap: 6, width: '100%', marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 'none' }}>
              <button className="iconbtn" aria-label={t('Fewer rounds')} style={{ width: 26, height: 26, borderRadius: 7 }} onClick={() => setRounds(e.sg, unit, circ.rounds - 1)}><Icon name="minus" /></button>
              <span style={{ minWidth: 58, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{t('{0} rounds', circ.rounds)}</span>
              <button className="iconbtn" aria-label={t('More rounds')} style={{ width: 26, height: 26, borderRadius: 7 }} onClick={() => setRounds(e.sg, unit, circ.rounds + 1)}><Icon name="plus" /></button>
            </div>
            <input className="input" style={{ flex: 1, minWidth: 90, height: 30, fontSize: 13 }} placeholder={t('Label (optional)')}
              defaultValue={circ.label} onChange={ev => setCircuitLabel(e.sg, ev.target.value)} />
          </div>}
        </div>}
        <div className={'item' + (inSS.has(i) ? ' in-ss' : '')} onClick={() => {
          exConfigSheet(ex, e, cfg => edit(x => { x[i] = { id: x[i].id, sg: x[i].sg, ...cfg } }), () => edit(x => x.splice(i, 1)), r, () => swapAt(i))
        }}>
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{ex.n}</div><div className="ss">{exLine(e, S.unit)}</div></div>
          <div style={{ display: 'flex', gap: 4, flex: 'none', alignItems: 'center' }}>
            {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15 }} onClick={ev => { ev.stopPropagation(); toggleLink(i) }}><Icon name="link" /></button>}
            <button className="iconbtn" aria-label={t('Drag to reorder')} title={t('Drag to reorder')}
              style={{ width: 34, height: 34, borderRadius: 8, fontSize: 15, cursor: 'grab', touchAction: 'none' }}
              onClick={ev => ev.stopPropagation()}
              onPointerDown={ev => dragStart(i, ev)} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
              <Icon name="list" />
            </button>
          </div>
        </div>
      </div>
    })}</div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}

    {/* Coverage of the routine as planned, so a gap shows up while you're building it
        rather than after a month of training around it. */}
    {r.ex.length > 0 && (() => {
      const load = loadOfRoutine(r)
      const { worked } = rankOf(load)
      return <div className="card" style={{ marginTop: 12 }}>
        <h2>{t('What this session hits')}</h2>
        <BodyMap load={load} body={S.body} />
        <div className="mchips">
          {worked.slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m])}</span>)}
        </div>
      </div>
    })()}

    <div className="small dim row" style={{ margin: '10px 2px', gap: 5 }}><Icon name="link" style={{ fontSize: 13 }} />{t('Tap the link button to superset an exercise with the one above; drag the handle to reorder.')}</div>
    <Button variant="primary" onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) }), null, r))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => confirmSheet({
      title: t('Delete routine?'), message: t('“{0}” and its exercises will be removed.', r.name), confirmText: t('Delete'), danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = s.routines.filter(x => x.id !== id)
          Object.keys(s.week).forEach(k => { if (s.week[k] === id) delete s.week[k] })
          Object.keys(s.dayPlan).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
        })
        nav('/plan')
      }
    })}>{t('Delete routine')}</Button>
  </div>
}
