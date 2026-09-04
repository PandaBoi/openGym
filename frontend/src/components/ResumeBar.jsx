import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import Icon from './Icon.jsx'

// A workout in progress must be one tap away from anywhere in the app, not just from the
// tab bar's own Start/Resume button (issue: browsing Plan/Stats/Settings mid-session had no
// obvious way back short of remembering that button exists). Hidden on /workout itself, and
// while the rest/work timer bar is up — that bar already means "workout in progress" and is
// itself tappable (see RestTimer.jsx), so the two never stack.
export default function ResumeBar() {
  const active = useStore(s => s.S.active)
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const loc = useLocation()
  const on = !!active && loc.pathname !== '/workout' && !timer && !work
  useEffect(() => {
    document.body.classList.toggle('resuming', on)
    return () => document.body.classList.remove('resuming')
  }, [on])
  if (!on) return null
  return (
    <button id="resumebar" onClick={() => nav('/workout')}>
      <span className="dot" />
      <span className="lbl">{active.name || t('Freestyle')} — {t('workout in progress')}</span>
      <Icon name="chevronRight" />
    </button>
  )
}
