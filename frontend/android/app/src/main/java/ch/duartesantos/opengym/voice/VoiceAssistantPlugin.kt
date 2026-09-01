package ch.duartesantos.opengym.voice

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.Locale

/**
 * Milestone 3 voice bridge — all on-device, no network.
 *
 *  - STT: android.speech.SpeechRecognizer with EXTRA_PREFER_OFFLINE. Uses the phone's
 *    on-device recognition model where one is installed (Pixel and most modern Androids
 *    ship one). Milestone 3b swaps this for a bundled whisper.cpp so offline is guaranteed
 *    on every device — the JS-facing events here stay the same.
 *  - TTS: android.speech.tts.TextToSpeech with the platform offline voices.
 *
 * Events emitted to JS (addListener):
 *   partial   { text }              interim transcript while the user is speaking
 *   result    { text }              final transcript
 *   sttError  { code, message }     recognition failed / nothing heard
 *   sttEnd    {}                    recognizer finished (success or error)
 *   speakDone { id }                an utterance finished
 */
@CapacitorPlugin(
    name = "VoiceAssistant",
    permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])]
)
class VoiceAssistantPlugin : Plugin() {

    private var recognizer: SpeechRecognizer? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false

    override fun load() {
        tts = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) {
                try { tts?.language = Locale.getDefault() } catch (_: Exception) {}
                try { if (tts?.voice == null) tts?.language = Locale.US } catch (_: Exception) {}
            }
        }
    }

    override fun handleOnDestroy() {
        activity?.runOnUiThread {
            try { recognizer?.destroy() } catch (_: Exception) {}
            recognizer = null
        }
        try { tts?.shutdown() } catch (_: Exception) {}
        tts = null
    }

    // ---- capabilities -------------------------------------------------------

    @PluginMethod
    fun available(call: PluginCall) {
        val res = JSObject()
        res.put("stt", SpeechRecognizer.isRecognitionAvailable(context))
        res.put("tts", tts != null)
        call.resolve(res)
    }

    // ---- permission -------------------------------------------------------

    @PluginMethod
    fun ensurePermission(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            val r = JSObject(); r.put("granted", true); call.resolve(r)
        } else {
            requestPermissionForAlias("microphone", call, "permCallback")
        }
    }

    @PermissionCallback
    private fun permCallback(call: PluginCall) {
        val r = JSObject()
        r.put("granted", getPermissionState("microphone") == PermissionState.GRANTED)
        call.resolve(r)
    }

    // ---- speech to text -------------------------------------------------------

    @PluginMethod
    fun startListening(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("microphone permission not granted"); return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            call.reject("no speech recognition service on this device"); return
        }
        val locale = call.getString("locale") ?: Locale.getDefault().toLanguageTag()
        activity.runOnUiThread {
            try {
                recognizer?.destroy()
                recognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                    setRecognitionListener(listener)
                }
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    // On-device where a model is present; harmless where it is not.
                    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                }
                recognizer?.startListening(intent)
                call.resolve()
            } catch (e: Exception) {
                call.reject("startListening failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun stopListening(call: PluginCall) {
        activity.runOnUiThread {
            try { recognizer?.stopListening() } catch (_: Exception) {}
            call.resolve()
        }
    }

    @PluginMethod
    fun cancelListening(call: PluginCall) {
        activity.runOnUiThread {
            try { recognizer?.cancel() } catch (_: Exception) {}
            call.resolve()
        }
    }

    private fun firstOf(results: Bundle?): String {
        val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
        return list?.firstOrNull()?.trim().orEmpty()
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { notifyListeners("sttReady", JSObject()) }
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onPartialResults(partialResults: Bundle?) {
            val text = firstOf(partialResults)
            if (text.isNotEmpty()) notifyListeners("partial", JSObject().put("text", text))
        }

        override fun onResults(results: Bundle?) {
            notifyListeners("result", JSObject().put("text", firstOf(results)))
            notifyListeners("sttEnd", JSObject())
        }

        override fun onError(error: Int) {
            val msg = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH -> "no match"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no speech"
                SpeechRecognizer.ERROR_AUDIO -> "audio error"
                SpeechRecognizer.ERROR_NETWORK -> "network error (no on-device model?)"
                SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network timeout"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission denied"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer busy"
                SpeechRecognizer.ERROR_CLIENT -> "client error"
                else -> "error $error"
            }
            notifyListeners("sttError", JSObject().put("code", error).put("message", msg))
            notifyListeners("sttEnd", JSObject())
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    // ---- text to speech -------------------------------------------------------

    @PluginMethod
    fun speak(call: PluginCall) {
        val text = call.getString("text")
        if (text.isNullOrBlank()) { call.reject("text required"); return }
        val engine = tts
        if (engine == null || !ttsReady) { call.reject("tts not ready"); return }
        val rate = call.getFloat("rate") ?: 1.0f
        val id = call.getString("id") ?: System.currentTimeMillis().toString()
        engine.setOnUtteranceProgressListener(object : android.speech.tts.UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) {}
            override fun onDone(utteranceId: String?) {
                notifyListeners("speakDone", JSObject().put("id", utteranceId))
            }
            @Deprecated("deprecated in API 21")
            override fun onError(utteranceId: String?) {
                notifyListeners("speakDone", JSObject().put("id", utteranceId).put("error", true))
            }
        })
        engine.setSpeechRate(rate)
        val queue = if (call.getBoolean("queue", false) == true) TextToSpeech.QUEUE_ADD else TextToSpeech.QUEUE_FLUSH
        engine.speak(text, queue, null, id)
        call.resolve(JSObject().put("id", id))
    }

    @PluginMethod
    fun stopSpeaking(call: PluginCall) {
        try { tts?.stop() } catch (_: Exception) {}
        call.resolve()
    }

    @PluginMethod
    fun isSpeaking(call: PluginCall) {
        call.resolve(JSObject().put("speaking", tts?.isSpeaking == true))
    }
}
