// On-device voice bridge — push-to-talk speech-to-text + text-to-speech.
//
// Native (Capacitor / Android): ch.duartesantos.opengym.voice.VoiceAssistantPlugin
//   Milestone 3  — android.speech.SpeechRecognizer (EXTRA_PREFER_OFFLINE) + TextToSpeech
//   Milestone 3b — bundled whisper.cpp; this file's API does not change.
// Web (npm run dev / PWA): window.SpeechRecognition + window.speechSynthesis, so the
//   whole flow can be exercised on a laptop before an APK is built.
//
// Nothing here talks to a server.

import { MOBILE } from './mobile.js'

let _plugin = null
async function plugin() {
  if (_plugin) return _plugin
  const { registerPlugin } = await import('@capacitor/core')
  _plugin = registerPlugin('VoiceAssistant')
  return _plugin
}

/* ------------------------------------------------------------------ native ---- */

function nativeVoice() {
  return {
    async available() {
      try { return await (await plugin()).available() } catch { return { stt: false, tts: false } }
    },
    async ensurePermission() {
      try { return (await (await plugin()).ensurePermission()).granted } catch { return false }
    },
    async speak(text, { rate = 1 } = {}) {
      try { await (await plugin()).speak({ text, rate }) } catch { /* ignore */ }
    },
    async stopSpeaking() {
      try { await (await plugin()).stopSpeaking() } catch { /* ignore */ }
    },
    // handlers: { onPartial(text), onResult(text), onError({code,message}) }
    // returns { stop() } — call it on button-release to end capture.
    async listen(handlers = {}) {
      const p = await plugin()
      const subs = []
      subs.push(await p.addListener('partial', e => handlers.onPartial?.(e.text || '')))
      subs.push(await p.addListener('result', e => { cleanup(); handlers.onResult?.((e.text || '').trim()) }))
      subs.push(await p.addListener('sttError', e => { cleanup(); handlers.onError?.(e) }))
      let done = false
      const cleanup = () => { if (done) return; done = true; subs.forEach(s => { try { s.remove() } catch {} }) }
      try {
        await p.startListening({ locale: (navigator.language || 'en-US') })
      } catch (e) {
        cleanup(); handlers.onError?.({ message: String(e?.message || e) })
        return { stop() {} }
      }
      return {
        stop: async () => { try { await p.stopListening() } catch {} },
        cancel: async () => { cleanup(); try { await p.cancelListening() } catch {} },
      }
    },
  }
}

/* --------------------------------------------------------------------- web ---- */

function webVoice() {
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null
  return {
    async available() { return { stt: !!SR, tts: !!synth } },
    async ensurePermission() {
      // getUserMedia both prompts and warms the mic; SpeechRecognition will prompt anyway.
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); return true }
      catch { return false }
    },
    async speak(text, { rate = 1 } = {}) {
      if (!synth) return
      synth.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.rate = rate
      synth.speak(u)
    },
    async stopSpeaking() { synth?.cancel() },
    async listen(handlers = {}) {
      if (!SR) { handlers.onError?.({ message: 'no SpeechRecognition in this browser' }); return { stop() {} } }
      const rec = new SR()
      rec.lang = navigator.language || 'en-US'
      rec.interimResults = true
      rec.maxAlternatives = 1
      rec.continuous = false
      let finalText = ''
      rec.onresult = ev => {
        let interim = ''
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i]
          if (r.isFinal) finalText += r[0].transcript
          else interim += r[0].transcript
        }
        if (interim) handlers.onPartial?.((finalText + interim).trim())
      }
      rec.onerror = ev => handlers.onError?.({ code: ev.error, message: ev.error })
      rec.onend = () => handlers.onResult?.(finalText.trim())
      try { rec.start() } catch (e) { handlers.onError?.({ message: String(e?.message || e) }); return { stop() {} } }
      return {
        stop: () => { try { rec.stop() } catch {} },
        cancel: () => { try { rec.abort() } catch {} },
      }
    },
  }
}

export const voice = MOBILE ? nativeVoice() : webVoice()
