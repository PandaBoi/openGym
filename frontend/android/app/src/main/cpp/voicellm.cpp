// Minimal JNI shim over llama.cpp for the on-device voice agent.
// Prompt formatting (ChatML etc.) is done in Kotlin/JS — this layer only tokenizes,
// decodes, samples (optionally GBNF-constrained) and detokenizes.

#include <jni.h>
#include <android/log.h>
#include <string>
#include <vector>
#include <mutex>

#include "llama.h"

#define LOG_TAG "voicellm"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {
llama_model   *g_model   = nullptr;
llama_context *g_ctx      = nullptr;
int            g_n_ctx    = 0;
std::mutex     g_mutex;

std::string jstr(JNIEnv *env, jstring s) {
    if (!s) return {};
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

std::vector<llama_token> tokenize(const llama_vocab *vocab, const std::string &text, bool add_special) {
    int n = -llama_tokenize(vocab, text.c_str(), (int32_t) text.size(), nullptr, 0, add_special, true);
    std::vector<llama_token> toks(n);
    int got = llama_tokenize(vocab, text.c_str(), (int32_t) text.size(), toks.data(), n, add_special, true);
    if (got < 0) toks.clear(); else toks.resize(got);
    return toks;
}

std::string piece(const llama_vocab *vocab, llama_token tok) {
    char buf[256];
    int n = llama_token_to_piece(vocab, tok, buf, sizeof(buf), 0, false);
    if (n < 0) return {};
    return std::string(buf, n);
}
} // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_ch_duartesantos_opengym_voice_LlamaBridge_nativeInit(JNIEnv *, jobject) {
    llama_log_set([](ggml_log_level lvl, const char *text, void *) {
        if (lvl >= GGML_LOG_LEVEL_ERROR) __android_log_write(ANDROID_LOG_ERROR, LOG_TAG, text);
    }, nullptr);
    llama_backend_init();
}

JNIEXPORT jboolean JNICALL
Java_ch_duartesantos_opengym_voice_LlamaBridge_nativeLoad(JNIEnv *env, jobject, jstring path_, jint n_ctx, jint n_threads) {
    std::lock_guard<std::mutex> lock(g_mutex);
    const std::string path = jstr(env, path_);

    if (g_ctx)   { llama_free(g_ctx);        g_ctx   = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }

    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;                       // CPU only on phones (mmap is the default load_mode)

    g_model = llama_model_load_from_file(path.c_str(), mp);
    if (!g_model) { LOGE("model load failed: %s", path.c_str()); return JNI_FALSE; }

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx           = n_ctx > 0 ? (uint32_t) n_ctx : 4096;
    cp.n_batch         = 512;
    cp.n_threads       = n_threads > 0 ? n_threads : 4;
    cp.n_threads_batch = cp.n_threads;

    g_ctx = llama_init_from_model(g_model, cp);
    if (!g_ctx) { LOGE("context init failed"); llama_model_free(g_model); g_model = nullptr; return JNI_FALSE; }

    g_n_ctx = (int) llama_n_ctx(g_ctx);
    LOGI("model loaded, n_ctx=%d", g_n_ctx);
    return JNI_TRUE;
}

JNIEXPORT jstring JNICALL
Java_ch_duartesantos_opengym_voice_LlamaBridge_nativeGenerate(JNIEnv *env, jobject, jstring prompt_, jstring grammar_, jint max_tokens, jfloat temp) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_ctx || !g_model) return env->NewStringUTF("");

    const llama_vocab *vocab = llama_model_get_vocab(g_model);
    const std::string prompt  = jstr(env, prompt_);
    const std::string grammar = jstr(env, grammar_);

    // fresh KV per call — each utterance is standalone
    llama_memory_clear(llama_get_memory(g_ctx), true);

    std::vector<llama_token> toks = tokenize(vocab, prompt, true);
    if (toks.empty()) return env->NewStringUTF("");
    if ((int) toks.size() >= g_n_ctx - 8) toks.resize(g_n_ctx - 8);

    // sampler chain
    llama_sampler *smpl = llama_sampler_chain_init(llama_sampler_chain_default_params());
    if (!grammar.empty()) {
        llama_sampler *g = llama_sampler_init_grammar(vocab, grammar.c_str(), "root");
        if (g) llama_sampler_chain_add(smpl, g);
    }
    if (temp <= 0.0f) {
        llama_sampler_chain_add(smpl, llama_sampler_init_greedy());
    } else {
        llama_sampler_chain_add(smpl, llama_sampler_init_top_k(40));
        llama_sampler_chain_add(smpl, llama_sampler_init_top_p(0.95f, 1));
        llama_sampler_chain_add(smpl, llama_sampler_init_temp(temp));
        llama_sampler_chain_add(smpl, llama_sampler_init_dist(LLAMA_DEFAULT_SEED));
    }

    // decode the prompt
    llama_batch batch = llama_batch_get_one(toks.data(), (int32_t) toks.size());
    if (llama_decode(g_ctx, batch) != 0) {
        llama_sampler_free(smpl);
        return env->NewStringUTF("");
    }

    std::string out;
    int n_generated = 0;
    const int cap = max_tokens > 0 ? max_tokens : 256;
    llama_token cur = 0;

    for (; n_generated < cap; ++n_generated) {
        cur = llama_sampler_sample(smpl, g_ctx, -1);
        if (llama_vocab_is_eog(vocab, cur)) break;
        out += piece(vocab, cur);
        if (out.size() > 4096) break;
        llama_batch nb = llama_batch_get_one(&cur, 1);
        if (llama_decode(g_ctx, nb) != 0) break;
    }

    llama_sampler_free(smpl);
    return env->NewStringUTF(out.c_str());
}

JNIEXPORT jboolean JNICALL
Java_ch_duartesantos_opengym_voice_LlamaBridge_nativeIsLoaded(JNIEnv *, jobject) {
    return (g_ctx && g_model) ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_ch_duartesantos_opengym_voice_LlamaBridge_nativeFree(JNIEnv *, jobject) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (g_ctx)   { llama_free(g_ctx);         g_ctx   = nullptr; }
    if (g_model) { llama_model_free(g_model);  g_model = nullptr; }
}

} // extern "C"
