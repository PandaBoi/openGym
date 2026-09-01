package ch.duartesantos.opengym.voice

/**
 * JNI surface for the on-device LLM (voicellm.cpp + vendored llama.cpp).
 * Prompt formatting is done in Kotlin/JS; this only tokenises, decodes, samples
 * (optionally GBNF-constrained) and detokenises. All calls are serialised on a
 * single worker thread by VoiceAssistantPlugin.
 */
object LlamaBridge {
    @Volatile private var libOk = false

    fun ensureLib(): Boolean {
        if (libOk) return true
        return try { System.loadLibrary("voicellm"); nativeInit(); libOk = true; true }
        catch (t: Throwable) { false }
    }

    external fun nativeInit()
    external fun nativeLoad(path: String, nCtx: Int, nThreads: Int): Boolean
    external fun nativeGenerate(prompt: String, grammar: String, maxTokens: Int, temp: Float): String
    external fun nativeIsLoaded(): Boolean
    external fun nativeFree()
}
