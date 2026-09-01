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
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors

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

    // one recognition "session": tracks whether we heard onReadyForSpeech yet and whether
    // we've already burned our one auto-retry for a spurious early disconnect.
    private var gotReady = false
    private var retried = false
    private var startedAt = 0L
    private var lastLocale = "en-US"

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

    private fun buildIntent(locale: String) = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)   // on-device where a model exists; harmless otherwise
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }

    // Recreate the recognizer from scratch each session. Reusing one instance across
    // sessions is what triggers ERROR_SERVER_DISCONNECTED (11) on the *next* start on
    // Samsung — the previous service binding is still tearing down.
    private fun freshRecognizer(): SpeechRecognizer {
        try { recognizer?.cancel() } catch (_: Exception) {}
        try { recognizer?.destroy() } catch (_: Exception) {}
        return SpeechRecognizer.createSpeechRecognizer(context).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
    }

    @PluginMethod
    fun startListening(call: PluginCall) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("microphone permission not granted"); return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            call.reject("no speech recognition service on this device"); return
        }
        lastLocale = call.getString("locale") ?: Locale.getDefault().toLanguageTag()
        activity.runOnUiThread {
            gotReady = false
            retried = false
            startedAt = System.currentTimeMillis()
            try {
                freshRecognizer().startListening(buildIntent(lastLocale))
                call.resolve()
            } catch (e: Exception) {
                call.reject("startListening failed: ${e.message}")
            }
        }
    }

    // one-shot recovery for a spurious disconnect that lands before the mic is even live
    private fun retryStart() {
        retried = true
        activity.runOnUiThread {
            startedAt = System.currentTimeMillis()
            gotReady = false
            try { freshRecognizer().startListening(buildIntent(lastLocale)) } catch (_: Exception) {}
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
        override fun onReadyForSpeech(params: Bundle?) { gotReady = true; notifyListeners("sttReady", JSObject()) }
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
            releaseSoon()
        }

        override fun onError(error: Int) {
            // A CLIENT / BUSY / SERVER_DISCONNECTED error that fires before the mic is even
            // live (no onReadyForSpeech, < 900ms in) is the Samsung "previous session still
            // closing" bug — silently start over once instead of surfacing it.
            val transient = error == SpeechRecognizer.ERROR_CLIENT ||
                error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY ||
                error == 11 /* ERROR_SERVER_DISCONNECTED */
            if (transient && !gotReady && !retried && System.currentTimeMillis() - startedAt < 900) {
                retryStart(); return
            }
            val msg = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH -> "no match"
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no speech"
                SpeechRecognizer.ERROR_AUDIO -> "audio error"
                SpeechRecognizer.ERROR_NETWORK -> "network error (no on-device model?)"
                SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network timeout"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission denied"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "recognizer busy"
                SpeechRecognizer.ERROR_CLIENT -> "client error"
                11 -> "recognizer disconnected"
                else -> "error $error"
            }
            notifyListeners("sttError", JSObject().put("code", error).put("message", msg))
            notifyListeners("sttEnd", JSObject())
            releaseSoon()
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    // Tear the recognizer down after a session ends so the next start() builds a clean one
    // with no half-closed service binding to race.
    private fun releaseSoon() {
        activity?.runOnUiThread {
            try { recognizer?.destroy() } catch (_: Exception) {}
            recognizer = null
        }
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

    // ---- on-device LLM (Milestone 4) ----------------------------------------
    // All native LLM calls run on one worker thread — llama.cpp state is not reentrant.

    private val llmExec = Executors.newSingleThreadExecutor()

    @PluginMethod
    fun llmAvailable(call: PluginCall) {
        call.resolve(JSObject().put("available", LlamaBridge.ensureLib()))
    }

    @PluginMethod
    fun loadModel(call: PluginCall) {
        val path = call.getString("path")
        if (path.isNullOrBlank()) { call.reject("path required"); return }
        val nCtx = call.getInt("nCtx") ?: 4096
        val cores = Runtime.getRuntime().availableProcessors()
        val nThreads = call.getInt("nThreads") ?: (cores - 2).coerceIn(2, 6)
        llmExec.execute {
            if (!LlamaBridge.ensureLib()) { call.reject("native lib unavailable"); return@execute }
            if (!File(path).exists()) { call.reject("model file not found: $path"); return@execute }
            val ok = try { LlamaBridge.nativeLoad(path, nCtx, nThreads) } catch (t: Throwable) { false }
            if (ok) call.resolve(JSObject().put("loaded", true).put("nCtx", nCtx).put("nThreads", nThreads))
            else call.reject("model load failed")
        }
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt")
        if (prompt == null) { call.reject("prompt required"); return }
        val grammar = call.getString("grammar") ?: ""
        val maxTokens = call.getInt("maxTokens") ?: 256
        val temp = call.getFloat("temp") ?: 0.0f
        llmExec.execute {
            if (!LlamaBridge.nativeIsLoaded()) { call.reject("no model loaded"); return@execute }
            val t0 = System.currentTimeMillis()
            val text = try { LlamaBridge.nativeGenerate(prompt, grammar, maxTokens, temp) }
                catch (t: Throwable) { call.reject("generate failed: ${t.message}"); return@execute }
            call.resolve(JSObject().put("text", text).put("ms", System.currentTimeMillis() - t0))
        }
    }

    @PluginMethod
    fun modelLoaded(call: PluginCall) {
        val loaded = try { LlamaBridge.ensureLib() && LlamaBridge.nativeIsLoaded() } catch (_: Throwable) { false }
        call.resolve(JSObject().put("loaded", loaded))
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        llmExec.execute {
            try { if (LlamaBridge.ensureLib()) LlamaBridge.nativeFree() } catch (_: Throwable) {}
            call.resolve()
        }
    }

    // ---- model file management --------------------------------------------
    // GGUF models are ~0.7–2 GB — far too big for the APK, so they download on first use
    // into the app's private files dir. Streamed with resume; progress events to JS.

    private val dlExec = Executors.newSingleThreadExecutor()
    @Volatile private var cancelDl = false

    private fun modelsDir(): File = File(context.filesDir, "models").apply { mkdirs() }

    @PluginMethod
    fun modelInfo(call: PluginCall) {
        val name = call.getString("name") ?: run { call.reject("name required"); return }
        val f = File(modelsDir(), name)
        val part = File(modelsDir(), "$name.part")
        call.resolve(JSObject()
            .put("exists", f.exists())
            .put("path", f.absolutePath)
            .put("bytes", if (f.exists()) f.length() else 0L)
            .put("partialBytes", if (part.exists()) part.length() else 0L))
    }

    @PluginMethod
    fun deleteModel(call: PluginCall) {
        val name = call.getString("name") ?: run { call.reject("name required"); return }
        File(modelsDir(), name).delete()
        File(modelsDir(), "$name.part").delete()
        call.resolve()
    }

    @PluginMethod
    fun cancelDownload(call: PluginCall) { cancelDl = true; call.resolve() }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val url = call.getString("url") ?: run { call.reject("url required"); return }
        val name = call.getString("name") ?: run { call.reject("name required"); return }
        val expectMin = call.getInt("minBytes") ?: 0
        val dest = File(modelsDir(), name)
        val part = File(modelsDir(), "$name.part")
        if (dest.exists()) { call.resolve(JSObject().put("path", dest.absolutePath).put("bytes", dest.length())); return }
        cancelDl = false
        dlExec.execute {
            try {
                var have = if (part.exists()) part.length() else 0L
                val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 20000; readTimeout = 30000
                    instanceFollowRedirects = true
                    setRequestProperty("User-Agent", "openGym-voice/1")
                    if (have > 0) setRequestProperty("Range", "bytes=$have-")
                }
                val code = conn.responseCode
                if (code == 200 && have > 0) { have = 0L; part.delete() }   // server ignored Range — restart
                if (code != 200 && code != 206) { conn.disconnect(); call.reject("http $code"); return@execute }
                val total = have + conn.contentLengthLong.coerceAtLeast(0L)

                conn.inputStream.use { inp ->
                    FileOutputStream(part, have > 0).use { out ->
                        val buf = ByteArray(1 shl 16)
                        var lastEmit = 0L
                        while (true) {
                            if (cancelDl) { conn.disconnect(); call.reject("cancelled"); return@execute }
                            val n = inp.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n); have += n
                            if (have - lastEmit >= 1_000_000L) {
                                lastEmit = have
                                notifyListeners("modelProgress", JSObject()
                                    .put("name", name).put("received", have).put("total", total)
                                    .put("pct", if (total > 0) (have * 100 / total).toInt() else 0))
                            }
                        }
                    }
                }
                conn.disconnect()
                if (expectMin in 1..Int.MAX_VALUE && part.length() < expectMin) {
                    part.delete(); call.reject("download too small (${part.length()} bytes)"); return@execute
                }
                if (!part.renameTo(dest)) { call.reject("rename failed"); return@execute }
                notifyListeners("modelProgress", JSObject().put("name", name).put("received", dest.length()).put("total", dest.length()).put("pct", 100))
                call.resolve(JSObject().put("path", dest.absolutePath).put("bytes", dest.length()))
            } catch (e: Exception) {
                call.reject("download failed: ${e.message}")
            }
        }
    }
}
