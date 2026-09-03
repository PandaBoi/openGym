import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { fmtSec } from '../lib/history.js'
import { WorkoutRow, workoutDetailSheet } from '../sheets.jsx'
import { circuitRuns } from '../lib/circuits.js'
import Icon from '../components/Icon.jsx'

function CircuitLog({ S }) {
  const runs = circuitRuns(S)
  if (!runs.length) return null
  const byCid = new Map()
  runs.forEach(r => { if (!byCid.has(r.cid)) byCid.set(r.cid, []); byCid.get(r.cid).push(r) })
  return <div style={{ marginBottom: 22 }}>
    <h4 className="sec">{t('Circuit runs')}</h4>
    {[...byCid.values()].map(list => <div key={list[0].cid} className="card" style={{ marginBottom: 10 }}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <b>{list[0].label || t('Untitled circuit')}</b>
        <span className="small dim">{t(list.length === 1 ? '{0} run' : '{0} runs', list.length)}</span>
      </div>
      {list.slice(0, 6).map((r, i) => <div key={i} className="row between small" style={{ padding: '3px 0', color: 'var(--label-2)' }}>
        <span>{fmtDate(r.date)}</span>
        <span>{t('{0} rounds', r.rounds)}{r.reps ? ` · ${r.reps} ${t('reps')}` : ''}{r.sec ? ` · ${fmtSec(r.sec)}` : ''}</span>
      </div>)}
    </div>)}
  </div>
}

export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>{t('History')}</h1><div className="sub">{t('{0} workouts', S.workouts.length)}</div></div></div>
    <CircuitLog S={S} />
    {S.workouts.length ? <div className="list">{[...S.workouts].reverse().map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
      : <div className="empty"><div className="ico"><Icon name="history" /></div>{t('No workouts yet.')}</div>}
  </>
}
