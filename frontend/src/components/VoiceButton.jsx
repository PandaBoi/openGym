import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { MOBILE } from '../lib/mobile.js'
import { voice } from '../lib/voice.js'
import { parseIntent } from '../lib/voice-intents.js'
import { runIntent } from '../lib/voice-agent.js'
import Icon from './Icon.jsx'

// Push-to-talk button. Tap to listen, tap again (or let the recognizer settle) to act.
// Shows only during an active workout.
//
//   tap → listen → transcript → regex grammar; only what it can't place, and only when
//        voice.enabled, goes to the on-device LLM agent → run tools → speak the reply
//
// Everything on-device, no network. With voice enabled, App.jsx loads the LLM model at
// boot and keeps it resident for the session — the mic-press path below then just finds
// it loaded. If that boot load didn't happen (failed, or voice toggled on mid-session),
// this component loads the model lazily on the first mic press and unloads it when the
// workout ends or after IDLE_UNLOAD_MS with no voice use. It only ever unloads a model
// it loaded itself (ownsModelRef) — never the one warmed at boot.

const HINT = 'e.g. "log 8 reps at 60 kilos" · "next exercise" · "start rest" · "what\'s my target"'
const IDLE_UNLOAD_MS = 90_000

const llmEnabled = () => MOBILE && localStorage.getItem('voice.enabled') === '1'

export default function VoiceButton() {
  const active = useStore(s => s.S.active)
  const [supported, setSupported] = useState(null)   // null = checking
  const [state, setState] = useState('idle')          // idle | listening | thinking
  const [line, setLine] = useState('')                // transcript / reply shown in the bubble
  const [isReply, setIsReply] = useState(false)
  const ctrlRef = useRef(null)
  const hideRef = useRef(null)
  const idleRef = useRef(null)   // pending "unload the model" timer
  const loadRef = useRef(null)   // cached in-flight / resolved model load
  const ownsModelRef = useRef(false)   // true only if THIS component called load() (vs. boot warm-up)

  useEffect(() => {
    let ok = true
    voice.available().then(a => { if (ok) setSupported(!!a.stt) }).catch(() => ok && setSupported(false))
    return () => { ok = false }
  }, [])

  useEffect(() => () => {
    ctrlRef.current?.cancel?.()
    clearTimeout(hideRef.current)
    clearTimeout(idleRef.current)
    // workout ended / button unmounted — free the model straight away, but only if we
    // loaded it. A model warmed at boot stays resident for the session (App.jsx).
    if (ownsModelRef.current) {
      loadRef.current = null
      ownsModelRef.current = false
      import('../lib/voice-llm.js').then(({ voiceLlm }) => voiceLlm.unload()).catch(() => {})
    }
  }, [])

  // Load the model on demand; cache the promise so repeat taps in a session are instant.
  const ensureModel = () => {
    if (!loadRef.current) {
      loadRef.current = (async () => {
        const { voiceLlm, DEFAULT_MODEL } = await import('../lib/voice-llm.js')
        const key = localStorage.getItem('voice.model') || DEFAULT_MODEL
        if (!(await voiceLlm.isLoaded())) {
          console.log('[voice] loading model', key)
          await voiceLlm.load(key)
          ownsModelRef.current = true   // we loaded it, so we're responsible for unloading it
          console.log('[voice] model loaded')
        }
        return { voiceLlm, key }
      })().catch(e => { console.log('[voice] model load failed:', e && (e.message || e)); loadRef.current = null; return null })
    }
    return loadRef.current
  }

  const scheduleUnload = () => {
    if (!ownsModelRef.current) return   // boot-warmed model — leave it resident
    clearTimeout(idleRef.current)
    idleRef.current = setTimeout(async () => {
      loadRef.current = null
      ownsModelRef.current = false
      try {
        const { voiceLlm } = await import('../lib/voice-llm.js')
        await voiceLlm.unload()
        console.log('[voice] model unloaded (idle)')
      } catch { /* ignore */ }
    }, IDLE_UNLOAD_MS)
  }

  const flash = (text, reply) => {
    setLine(text); setIsReply(!!reply)
    clearTimeout(hideRef.current)
    hideRef.current = setTimeout(() => setLine(''), reply ? 7000 : 4000)
  }

  const handle = async raw => {
    setState('thinking')
    let reply
    try {
      // Deterministic fast path. A high-confidence spoken command — "log 8 at 60",
      // "add 3 sets", "next exercise", "start rest", "what's my target" — is run straight
      // off the grammar without waking the model: instant, no battery, and it can't misfire
      // the way a 1.5B occasionally does. Only phrases the grammar can't place ('unknown')
      // fall through to the LLM.
      const parsed = parseIntent(raw)
      if (parsed.intent !== 'unknown') {
        console.log('[voice] grammar handled:', parsed.intent, JSON.stringify(parsed.args || {}))
        reply = runIntent(parsed)
      } else if (llmEnabled()) {
        clearTimeout(idleRef.current)   // in use — cancel any pending unload
        flash('One sec — starting the voice model…')
        const loaded = await ensureModel()
        if (loaded) {
          const { voiceLlm, key } = loaded
          const { runAgent } = await import('../lib/voice-llm-agent.js')
          flash(raw)   // show the transcript while the model thinks
          console.log('[voice] runAgent start:', JSON.stringify(raw))
          const r = await Promise.race([
            runAgent(raw, voiceLlm.makeGenerate(key), { onStep: s => console.log('[voice] step', JSON.stringify(s)) }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('llm timeout')), 180000)),
          ])
          console.log('[voice] runAgent done:', JSON.stringify(r).slice(0, 300))
          reply = r.speak
        }
      }
      if (!reply) reply = runIntent(parseIntent(raw))
    } catch (e) {
      console.error('[voice] handle', e && (e.message || e))
      reply = runIntent(parseIntent(raw))   // fall back to the grammar
    }
    flash(reply, true)
    setState('idle')
    voice.speak(reply)
    if (llmEnabled()) scheduleUnload()   // free the model if no further voice use soon
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
      if (llmEnabled()) { clearTimeout(idleRef.current); ensureModel() }   // warm up while the user talks
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
        @keyframes vb-spin { to { transform: rotate(360deg) } }
        .vb-fab{position:fixed;right:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 84px);z-index:60;
          width:56px;height:56px;border-radius:50%;border:none;display:grid;place-items:center;
          background:var(--acc);color:#000;font-size:24px;cursor:pointer;
          box-shadow:0 6px 20px rgba(0,0,0,.35);transition:transform .12s ease,bottom .2s ease}
        .vb-fab:active{transform:scale(.94)}
        /* the rest/work timer bar takes the bottom of the screen — lift the FAB and its
           bubble clear of it so the mic never sits on top of Skip */
        body.resting .vb-fab{bottom:calc(env(safe-area-inset-bottom,0px) + 200px)}
        body.resting .vb-bubble{bottom:calc(env(safe-area-inset-bottom,0px) + 208px)}
        .vb-fab.on{animation:vb-pulse 1.4s infinite;background:#ff4d4f;color:#fff}
        .vb-fab.busy{background:var(--card,#1c1c1e);color:var(--acc)}
        .vb-fab.busy::before{content:'';position:absolute;inset:-3px;border-radius:50%;
          border:3px solid transparent;border-top-color:var(--acc);border-right-color:var(--acc);
          animation:vb-spin .8s linear infinite}
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
