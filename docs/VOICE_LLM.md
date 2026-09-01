# On-device voice assistant — architecture & performance notes

Everything runs on the phone. No network. Android only (arm64).

```
mic button → SpeechRecognizer (STT) → transcript
   → if an LLM model is loaded:  runAgent(transcript)  [voice-llm-agent.js]
        loop: LLM emits {"tool":…}|{"say":…} → run tool [voice-tools.js] → feed result back
   → else: regex grammar [voice-intents.js] → run one tool
   → TextToSpeech (TTS) speaks the reply
```

## Pieces

| Layer | File | Role |
|---|---|---|
| Native STT/TTS/LLM plugin | `android/app/src/main/java/.../voice/VoiceAssistantPlugin.kt` | `SpeechRecognizer` (EXTRA_PREFER_OFFLINE) + `TextToSpeech`; LLM methods `loadModel/generate/unloadModel`; model `downloadModel` (streamed, resumable) |
| JNI ↔ llama.cpp | `android/app/src/main/cpp/{voicellm.cpp,CMakeLists.txt}` + `LlamaBridge.kt` | load GGUF, tokenize, decode, GBNF-constrained sample, detokenize, **KV prefix reuse** |
| llama.cpp | `android/app/src/main/cpp/llama.cpp` (git submodule, pinned) | inference engine |
| JS bridge | `src/lib/voice.js` | STT/TTS wrappers + browser fallback for `npm run dev` |
| JS LLM bridge | `src/lib/voice-llm.js` | model catalogue, Qwen ChatML formatting, JSON GBNF grammar, `makeGenerate()` |
| Tool registry | `src/lib/voice-tools.js` | 6 query tools + 12 action tools over the workout stores; each returns plain JSON |
| Agent loop | `src/lib/voice-llm-agent.js` | transcript → tool-calling loop → spoken answer; transport-agnostic (unit-tested with a scripted model) |
| Grammar fallback | `src/lib/voice-intents.js` | deterministic spoken grammar, also the instant path while the model downloads |
| UI | `src/components/VoiceButton.jsx`, `views/Settings.jsx` (`VoiceAssistantCard`) | mic FAB during a workout; model download / on-off |

Models (`MODELS` in `voice-llm.js`): **Hammer 2.1 1.5B** (default, ~0.9 GB, `hammer`
format) / **Qwen2.5 3B** (alternate, ~1.8 GB, `chatml` format). **Q4_0** GGUF, downloaded
on first use into the app's private files dir. See "The model" below.

---

## The model — Hammer 2.1 1.5B (shipped v1.5.0, 2026-08-31)

The agent is only as good as the model's tool-*selection*. The benchmark measures exactly
that: `npm run eval:voice` (frontend → `python3 scripts/voice-eval/run.py`) runs 48 spoken
commands through the real GGUF and scores whether the right tool fires and a real answer
comes back. Cases are `cases.json`, models are `models.json`, adapters are
`src/lib/voice-llm-formats.js` (shared by the app and the benchmark — one source of truth).

### Bake-off (Mac / Metal, Q4_0, temp 0, deterministic — `clearHistory` per call)

| model | size | bench | notes |
|---|---|---|---|
| Qwen2.5-1.5B-Instruct | 0.9 GB | **25 %** | answers from the state snapshot, rarely calls a tool, invents numbers |
| Qwen2.5-3B-Instruct | 1.9 GB | **75 %** | tool selection mostly there, but ~1.8 GB resident is too heavy for the S23+ |
| **Hammer2.1-1.5b** (MadeAgents) | 0.9 GB | **90 %** | Qwen2.5-Coder-1.5B + "function masking". 3B-class selection in a 1.5B footprint. **Shipped.** |
| LFM2-1.2B-Tool (Liquid AI) | 0.7 GB | **35 %** | special-token fix confirmed (it *does* call tools now) — 35 % is its real, weak score. Out. |

`docs/VOICE_LLM.md` earlier showed 83 %/85 % for the 3B/Hammer — that was KV-reuse noise
before `clearHistory` was enforced.

### What this says

- **1.5B general-instruct models can't do the agent loop.** The jump is at ~3B for a
  *general* model — or a model **fine-tuned for function calling**, which puts 3B-class
  tool selection in a 1.5B footprint. That's Hammer.
- License is **cc-by-nc-4.0** — non-commercial. Fine for this personal fork; can't
  redistribute the app with it bundled.
- With the lazy load + unload lifecycle (VoiceButton, v1.4.1), the ~0.9 GB model only
  occupies RAM during a query, so it's comfortable on the S23+.

### How Hammer is wired (`src/lib/voice-llm-formats.js`, `hammerFormat`)

Its own chat template; tools passed as a JSON list; a `respond` pseudo-tool carries the
spoken answer; output parsed from a `[{"name","arguments"}]` list; **no GBNF grammar**
(`voice-llm.js makeGenerate()` passes `grammar: ''`, and `cpp/voicellm.cpp` already falls
through to a plain greedy sampler when the grammar string is empty — no native change was
needed). `runAgent` is untouched — it still sees neutral `{"tool"|"say"}` strings because
the adapter's `parse()` normalises Hammer's reply before returning.

`MODELS` in `voice-llm.js`: `hammer2.1-1.5b` (default, `format: 'hammer'`) and
`qwen2.5-3b` (`format: 'chatml'`, kept as an Apache-licensed alternate). The old
`qwen2.5-1.5b` entry was dropped — Hammer strictly dominates it.

### Fallbacks if the license ever matters

**Qwen3-1.7B** (Apache-2.0, same ChatML family, run with thinking disabled),
**LFM2.5-1.2B-Instruct** (BFCLv3 49). Sub-1B models reliably fail multi-turn / nested tool
calls — don't bother.

---

## Making it fast on Android (Snapdragon 8 Gen 2 / S23+)

First working build was ~50 s per model call. Ranked by impact:

### 1. ARM `dotprod` + `i8mm` — ~5–10× (the big one)
ggml's fast int8 matmul kernels need `armv8.2-a+dotprod` (+ `i8mm` for even more).
Cross-compiling for Android forces `GGML_NATIVE=OFF`, which **disables ggml's CPU feature
auto-detection**, so without an explicit `-march` you get the scalar fallback.
Fix — `android/app/build.gradle`:
```
externalNativeBuild { cmake { arguments
  "-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16" } }
```
Every phone from ~2018 on has dotprod; i8mm is ~2021+ (8 Gen 1 / Dimensity 9000 onward).

### 2. Q4_0, not Q4_K_M — ~1.5–2×
llama.cpp **repacks Q4_0 at load** into the i8mm/dotprod GEMM kernels (`Q4_0_4_8`,
`Q4_0_8_8`). Q4_K_M doesn't get that path on an ARM CPU. Same size, same quality tier,
noticeably faster prompt eval.

### 3. KV cache prefix reuse — big for the multi-step agent
Each agent turn re-sends `system prompt + all prior turns`. Re-decoding that every call is
most of the cost. `voicellm.cpp` keeps the context warm across `generate()` calls:
- keep `g_cache` = the token sequence currently resident in KV
- on the next call, find the longest common prefix with the new prompt
- `llama_memory_seq_rm(mem, 0, common, -1)` and decode **only** `newtoks[common..]`
- on context overflow, keep head (system) + tail (recent turns), drop the middle

Turn-2+ cost drops to roughly "new question + tool result + generation".

### 4. Threads = big cores only — ~1.3×
8 Gen 2 = 1 prime (X3) + 3 perf (A715) + 4 efficiency (A510). llama.cpp splits a batch
evenly, so the slow A510s bottleneck it. **`n_threads = 4`** on an 8-core SoC beats 6–8.

### 5. Smaller wins
- `flash_attn_type = ENABLED` — modest on CPU, grows with context length.
- `n_batch = n_ubatch = 1024` — better prompt-eval throughput than 512.
- `n_ctx = 2048` — the agent's prompts fit in ~1.2k tokens; smaller KV alloc.
- Trim the system prompt / tool descriptions — re-processed every turn.
- `maxSteps = 3`, `maxTokens = 128`.

### Not done (bigger lifts, revisit if CPU isn't enough)
- **Adreno GPU (OpenCL) backend** — ~1.5–2× on token gen. Flaky, larger build, Qwen2.5
  support has had bugs.
- **Hexagon NPU via QNN SDK** — potentially ~10×. Separate SDK, model conversion, weeks.
- **Speculative decoding** — 0.5B draft + 1.5B/3B target, ~2–3×. Needs a second model in RAM.
- **KV quantization** (`type_k`/`type_v = q8_0`) — halves KV memory, tiny speed cost. Not
  needed at n_ctx 2048.
- Pin threads to big cores with `sched_setaffinity` (llama.cpp doesn't by default from NDK).

### Sources
- llama.cpp Android perf discussion — https://github.com/ggml-org/llama.cpp/discussions/14356
- Snapdragon on-device LLM overview — https://grapeup.com/blog/running-llms-on-device-with-qualcomm-snapdragon-8-elite
- Speculative decoding on Android — https://mvpfactory.io/blog/speculative-decoding-on-android-wiring-a-draft-model-to-llama-cpp-for-2-3x/

---

## Benchmarking on device
```
adb logcat -s voicellm
#  "generate: prompt=NNNN chars, grammar=..., maxTok=128"
#  "generate done in NNNNms -> {...}"   <- per-call latency
```
Targets (1.5B Q4_0, 4 threads, S23+): first call (cold prompt) ≈ 3–8 s, follow-up agent
turns (warm KV) ≈ 1–3 s. If it's far off, dotprod almost certainly isn't in the build —
`llvm-readelf -a libvoicellm.so | grep -i "Tag_.*_use"` and check the ggml build log for
`+dotprod` in `ARCH_FLAGS`.

## Known follow-ups
- 16 KB ELF alignment for Android 15: `-Wl,-z,max-page-size=16384` + `useLegacyPackaging=false` (done).
- Second-mic-press `ERROR_SERVER_DISCONNECTED` (Samsung): fresh recognizer per session + one-shot retry (done).
- Streaming tokens to the UI (currently one blocking `generate` per turn).
- Confirm-before-destructive tools (`finish_workout`, `swap_exercise`, `remove_set`).
- Whisper.cpp STT (M3b) if SpeechRecognizer accuracy/offline becomes a problem — not needed on the S23+ so far.
