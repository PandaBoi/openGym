// Minimal JNI shim over llama.cpp for the on-device voice agent.
// Prompt formatting (ChatML etc.) is done in Kotlin/JS. This layer tokenizes, decodes,
// samples (optionally GBNF-constrained) and detokenizes — and keeps the KV cache warm
// across calls: successive prompts from one utterance share a long common prefix (the
// system prompt + earlier turns), so only the diverging suffix is re-decoded.

#include <jni.h>
#include <android/log.h>
#include <algorithm>
#include <string>
#include <vector>
#include <mutex>

#include "llama.h"

#define LOG_TAG "voicellm"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)

namespace {
llama_model   *g_model = nullptr;
llama_context *g_ctx   = nullptr;
int            g_n_ctx = 0;
std::vector<llama_token> g_cache;   // prompt tokens currently resident in KV seq 0
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

// Decode toks[start..] at absolute positions [start..], in n_batch chunks. Only the last
// token requests logits. Returns true on success.
bool decode_from(llama_context *ctx, const std::vector<llama_token> &toks, int start, int n_batch) {
    if (start >= (int) toks.size()) return true;
    llama_batch batch = llama_batch_init(n_batch, 0, 1);
    bool ok = true;
    for (int off = start; off < (int) toks.size() && ok; off += n_batch) {
        const int n = std::min(n_batch, (int) toks.size() - off);
        batch.n_tokens = n;
        for (int i = 0; i < n; ++i) {
            batch.token[i]     = toks[off + i];
            batch.pos[i]       = off + i;
            batch.n_seq_id[i]  = 1;
            batch.seq_id[i][0] = 0;
            batch.logits[i]    = (off + i == (int) toks.size() - 1) ? 1 : 0;
        }
        if (llama_decode(ctx, batch) != 0) ok = false;
    }
    llama_batch_free(batch);
    return ok;
}
} // namespace

extern "C" {

JNIEXPORT void JNICALL
Java_ch_duartesantos_opengym_voice_LlamaBridge_nativeInit(JNIEnv *, jobject) {
    llama_log_set([](ggml_log_level lvl, const char *text, void *) {
        // enum order is NONE,DEBUG,INFO,WARN,ERROR,CONT — forward only real errors
        if (lvl == GGML_LOG_LEVEL_ERROR) __android_log_write(ANDROID_LOG_ERROR, LOG_TAG, text);
    }, nullptr);
    llama_backend_init();
}

JNIEXPORT jboolean JNICALL
Java_ch_duartesantos_opengym_voice_LlamaBridge_nativeLoad(JNIEnv *env, jobject, jstring path_, jint n_ctx, jint n_threads) {
    std::lock_guard<std::mutex> lock(g_mutex);
    const std::string path = jstr(env, path_);

    if (g_ctx)   { llama_free(g_ctx);         g_ctx   = nullptr; }
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    g_cache.clear();

    llama_model_params mp = llama_model_default_params();
    mp.n_gpu_layers = 0;   // CPU only on phones (mmap is the default load_mode)

    g_model = llama_model_load_from_file(path.c_str(), mp);
    if (!g_model) { LOGE("model load failed: %s", path.c_str()); return JNI_FALSE; }

    llama_context_params cp = llama_context_default_params();
    cp.n_ctx           = n_ctx > 0 ? (uint32_t) n_ctx : 4096;
    cp.n_batch         = 1024;
    cp.n_ubatch        = 1024;
    cp.n_threads       = n_threads > 0 ? n_threads : 4;
    cp.n_threads_batch = cp.n_threads;
    cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;

    g_ctx = llama_init_from_model(g_model, cp);
    if (!g_ctx) { LOGE("context init failed"); llama_model_free(g_model); g_model = nullptr; return JNI_FALSE; }

    g_n_ctx = (int) llama_n_ctx(g_ctx);
    LOGI("model loaded, n_ctx=%d, threads=%d", g_n_ctx, cp.n_threads);
    return JNI_TRUE;
}

JNIEXPORT jstring JNICALL
Java_ch_duartesantos_opengym_voice_LlamaBridge_nativeGenerate(JNIEnv *env, jobject, jstring prompt_, jstring grammar_, jint max_tokens, jfloat temp) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_ctx || !g_model) return env->NewStringUTF("");

    const llama_vocab *vocab  = llama_model_get_vocab(g_model);
    const std::string  prompt  = jstr(env, prompt_);
    const std::string  grammar = jstr(env, grammar_);

    std::vector<llama_token> toks = tokenize(vocab, prompt, true);
    if (toks.empty()) return env->NewStringUTF("");
    if ((int) toks.size() >= g_n_ctx - 8) {
        // keep the head (system prompt) and the tail (recent turns); drop the middle
        const int keepHead = (g_n_ctx - 8) / 2, keepTail = (g_n_ctx - 8) - keepHead;
        std::vector<llama_token> t;
        t.insert(t.end(), toks.begin(), toks.begin() + keepHead);
        t.insert(t.end(), toks.end() - keepTail, toks.end());
        toks.swap(t);
        g_cache.clear();   // positions shifted — cache no longer valid
    }

    // longest common prefix with what's already in KV; re-decode from there
    int common = 0;
    const int maxCommon = std::min((int) g_cache.size(), (int) toks.size() - 1);
    while (common < maxCommon && g_cache[common] == toks[common]) ++common;
    llama_memory_seq_rm(llama_get_memory(g_ctx), 0, common, -1);

    if (!decode_from(g_ctx, toks, common, 1024)) { g_cache.clear(); return env->NewStringUTF(""); }
    g_cache = toks;

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

    std::string out;
    const int cap = max_tokens > 0 ? max_tokens : 256;
    int n_past = (int) toks.size();
    llama_batch gen = llama_batch_init(1, 0, 1);

    for (int i = 0; i < cap; ++i) {
        llama_token cur = llama_sampler_sample(smpl, g_ctx, -1);
        if (llama_vocab_is_eog(vocab, cur)) break;
        out += piece(vocab, cur);
        if ((int) out.size() > 4096) break;

        gen.n_tokens     = 1;
        gen.token[0]     = cur;
        gen.pos[0]       = n_past++;
        gen.n_seq_id[0]  = 1;
        gen.seq_id[0][0] = 0;
        gen.logits[0]    = 1;
        if (llama_decode(g_ctx, gen) != 0) break;
    }
    // generated tokens' KV lives past g_cache.size(); the next call's seq_rm(common) clears it.

    llama_batch_free(gen);
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
    if (g_model) { llama_model_free(g_model); g_model = nullptr; }
    g_cache.clear();
}

} // extern "C"
