import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import { Button } from './ui.jsx'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { addRest, stopRest, finishWorkEarly, stopWork, beginHold } = useUI()
  const on = timer && !work
  const loc = useLocation()
  // The bar is fixed above the tab bar and floats over whatever is beneath it — during a
  // rest that was the next set's row. Extra bottom padding lets the page scroll clear.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    return () => document.body.classList.remove('resting')
  }, [!!on])
  // A hold takes the whole screen: you're on the floor in a plank, so the number has to read
  // from there. Orange while getting into position, accent once the hold is counting.
  if (work) {
    const prep = !!work.prep
    const R = 122, C = 2 * Math.PI * R
    const frac = prep ? work.prep / 5 : work.left / work.total
    return (
      <div id="holdscreen" className={prep ? 'prep' : ''}>
        <div className="hs-n">{work.label}</div>
        <div className="hs-ring">
          <svg viewBox="0 0 270 270"><circle cx="135" cy="135" r={R} className="trk" />
            <circle cx="135" cy="135" r={R} className="arc" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} /></svg>
          <div className="hs-num"><b>{prep ? work.prep : clock(work.left)}</b><span>{prep ? t('Get ready') : t('of {0}', clock(work.total))}</span></div>
        </div>
        <div className="hs-acts">
          <Button onClick={stopWork}>{t('Cancel')}</Button>
          {prep ? <Button variant="primary" icon="play" onClick={beginHold}>{t('Go')}</Button>
            : <Button variant="primary" icon="check" onClick={finishWorkEarly}>{t('Done')}</Button>}
        </div>
      </div>
    )
  }
  if (!on) return null
  const pct = (on.left / on.total) * 100
  // The bar itself means "workout in progress" just as much as ResumeBar does, so away from
  // /workout it's tappable too — stop the tap reaching it from the action buttons.
  const jump = loc.pathname === '/workout' ? undefined : () => nav('/workout')
  const stop = e => e.stopPropagation()

  // Three controls plus the clock don't fit one line on a phone — at 360px the bar is left
  // with about 30px and stops saying anything. So the rest variant stacks: clock and bar
  // read at a glance, controls get their own row. −15 and +15 sit together in number-line
  // order; Skip is pushed to the far edge, away from the button you tap to buy more time.
  return (
    <div id="timer" className="rest" onClick={jump} role={jump ? 'button' : undefined}>
      <div className="head">
        <div className="t">{clock(timer.left)}</div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <div className="acts" onClick={stop}>
        <Button size="sm" icon="minus" onClick={() => addRest(-15)}>15s</Button>
        <Button size="sm" icon="plus" onClick={() => addRest(15)}>15s</Button>
        <Button size="sm" variant="primary" className="skip" onClick={stopRest}>{t('Skip')}</Button>
      </div>
    </div>
  )
}
