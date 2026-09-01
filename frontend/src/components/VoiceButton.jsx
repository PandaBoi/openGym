import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { voice } from '../lib/voice.js'
import { parseIntent } from '../lib/voice-intents.js'
import { runIntent } from '../lib/voice-agent.js'
import Icon from './Icon.jsx'

// Milestone 3 push-to-talk button. Tap to start listening, tap again (or let the
// recognizer settle) to act. Shows only during an active workout for now.
//
//   tap → listen → transcript → parseIntent → runIntent → speak the reply
//
// Everything on-device. Milestone 4 routes the transcript through a local LLM instead
// of parseIntent; this component is unaffected.

const HINT = 'e.g. "log 8 reps at 60 kilos" · "next exercise" · "start rest" · "what\'s my target"'

export default function VoiceButton() {
  const active = useStore(s => s.S.active)
  const [supported, setSupported] = useState(null)   // null = checking
  const [state, setState] = useState('idle')          // idle | listening | thinking
  const [line, setLine] = useState('')                // transcript / reply shown in the bubble
  const [isReply, setIsReply] = useState(false)
  const ctrlRef = useRef(null)
  const hideRef = useRef(null)

  useEffect(() => {
    let ok = true
    voice.available().then(a => { if (ok) setSupported(!!a.stt) }).catch(() => ok && setSupported(false))
    return () => { ok = false }
  }, [])

  useEffect(() => () => { ctrlRef.current?.cancel?.(); clearTimeout(hideRef.current) }, [])

  const flash = (text, reply) => {
    setLine(text); setIsReply(!!reply)
    clearTimeout(hideRef.current)
    hideRef.current = setTimeout(() => setLine(''), reply ? 7000 : 4000)
  }

  const handle = async raw => {
    setState('thinking')
    let reply
    try { reply = runIntent(parseIntent(raw)) }
    catch (e) { reply = 'Something went wrong doing that.'; console.error('[voice]', e) }
    flash(reply, true)
    setState('idle')
    voice.speak(reply)
  }

  const start = async () => {
    console.log('[voice] tap; state=', state)
    if (state === 'listening') { ctrlRef.current?.stop?.(); return }
    try {
      voice.stopSpeaking()
      flash('…')
      const granted = await voice.ensurePermission()
      console.log('[voice] permission granted=', granted)
      if (!granted) { flash('Microphone permission is off — enable it in Settings, then tap again.'); return }
      setLine(''); setState('listening')
      ctrlRef.current = await voice.listen({
        onPartial: t => setLine(t),
        onResult: t => {
          console.log('[voice] result=', JSON.stringify(t))
          ctrlRef.current = null
          if (!t) { setState('idle'); flash("Didn't catch that. " + HINT); return }
          handle(t)
        },
        onError: e => {
          console.log('[voice] sttError=', JSON.stringify(e))
          ctrlRef.current = null
          setState('idle')
          const m = e?.message || ''
          flash(/no match|no speech/i.test(m) ? "Didn't catch that. " + HINT : 'Mic error: ' + m)
        },
      })
      console.log('[voice] listen() started')
    } catch (e) {
      console.error('[voice] start() threw', e)
      setState('idle')
      flash('Voice error: ' + (e?.message || e))
    }
  }

  if (!active || supported === false) return null

  const listening = state === 'listening'
  return (
    <>
      <style>{`
        @keyframes vb-pulse { 0%{box-shadow:0 0 0 0 var(--acc)} 70%{box-shadow:0 0 0 14px transparent} 100%{box-shadow:0 0 0 0 transparent} }
        .vb-fab{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 84px);z-index:60;
          width:56px;height:56px;border-radius:50%;border:none;display:grid;place-items:center;
          background:var(--acc);color:#000;font-size:24px;cursor:pointer;
          box-shadow:0 6px 20px rgba(0,0,0,.35);transition:transform .12s ease}
        .vb-fab:active{transform:scale(.94)}
        .vb-fab.on{animation:vb-pulse 1.4s infinite;background:#ff4d4f;color:#fff}
        .vb-fab.busy{opacity:.7}
        .vb-bubble{position:fixed;left:16px;right:84px;bottom:calc(env(safe-area-inset-bottom,0px) + 92px);z-index:60;
          background:var(--card, #1c1c1e);color:var(--label, #fff);border:1px solid var(--sep, #333);
          border-radius:14px;padding:10px 12px;font-size:14px;line-height:1.35;
          box-shadow:0 8px 24px rgba(0,0,0,.4)}
        .vb-bubble.reply{border-color:var(--acc)}
        .vb-bubble .who{font-size:11px;letter-spacing:.04em;text-transform:uppercase;opacity:.5;display:block;margin-bottom:2px}
      `}</style>
      {line && (
        <div className={'vb-bubble' + (isReply ? ' reply' : '')}>
          <span className="who">{isReply ? 'Assistant' : listening ? 'Listening…' : 'You said'}</span>
          {line}
        </div>
      )}
      <button
        className={'vb-fab' + (listening ? ' on' : '') + (state === 'thinking' ? ' busy' : '')}
        aria-label={listening ? 'Stop listening' : 'Voice assistant'}
        onClick={start}
      >
        <Icon name={listening ? 'micOff' : 'mic'} />
      </button>
    </>
  )
}
