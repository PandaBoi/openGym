# Voice LLM — performance + answer quality

**Status: Needs investigation (one device measurement) → then Ready to implement**
**Classification: Both (native C++ + JS), Android only**
Branch: `voice-m3`. Repo: `/Users/rohanpanda/Codes/openGym`.

## Where it stands

M4 (on-device LLM agent) is built and works end-to-end:
mic → SpeechRecognizer → `runAgent` → llama.cpp `generate` (GBNF-constrained) → tool(s) → TTS.
Runtime confirmed good on the S23+: `DOTPROD=1 | MATMUL_INT8=1 | REPACK=1` (Q4_0 repack + dotprod + i8mm all active).

**Problem 1 — too slow.** 1.5B Q4_0, 4 threads, single `{"say"}` call for a ~380-token
prompt + ~14-token reply = **~8 s**. Expected ~2–3 s. Need the prompt-vs-gen timing split.

**Problem 2 — wrong answers.** 1.5B misread the state snapshot: asked "how many sets", it
said "8 sets of 22.5 kg" (that's the *target* 8 reps @ 22.5). Comprehension weak at 1.5B.

## RESUME HERE — step 1: get the timing breakdown (zero code, just a device run)

`voicellm.cpp` now logs (added this session, committed):
```
timing: prompt N tok (of T, C cached) in X ms = P tok/s | gen G tok in Y ms = Q tok/s
```
Have the user: open app (model auto-loads if `voice.enabled`), workout → mic → a question → wait.
```
adb -s R5CW92J110W logcat -s voicellm
```
Read the `timing:` line. Then:

- **If prompt tok/s is low (<80)** → prompt eval bound. Try: `n_ubatch` already 1024; try
  `n_threads=6`; check the `-march` actually hit ggml-cpu (it did: `.cxx/.../build.ninja` has
  `-march=armv8.2-a+dotprod+i8mm+fp16`). Consider trimming the system prompt further / gating
  tools by context.
- **If gen tok/s is low (<12)** → decode bound. Suspects in order:
  1. **GBNF grammar sampler** over Qwen's 151k vocab per token. Test: temporarily pass
     `grammar:""` from `voice-llm.js makeGenerate()` and re-time. If gen jumps, the grammar is
     the cost → replace `llama_sampler_init_grammar` with a lazy/constrained-only-on-`{` approach,
     or a much tighter grammar, or drop grammar and rely on `extractJson` + a retry.
  2. **flash_attn** — now AUTO; try DISABLED explicitly.
  3. **thread affinity** — 4 threads may land on A510 little cores. Real fix:
     `llama_attach_threadpool` with a CPU mask for the big cluster, or `sched_setaffinity`
     in the JNI worker before `generate`. S23+ topology: 0-2 A510, 3-4 A710, 5-6 A715, 7 X3
     (verify with `adb shell cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq`).

## step 2: answer quality

- If timing is acceptable after step 1, switch **DEFAULT_MODEL to `qwen2.5-3b`** in
  `src/lib/voice-llm.js` — S23+ has 8+GB, 3B Q4_0 ≈ 1.8GB. 3B reads the state reliably.
  (User already picked "Fast" once; they can pick "Smart" in Settings → Voice assistant.)
- Regardless: `stateSnapshot()` in `src/lib/voice-llm-agent.js` was rewritten to explicit
  key:value lines this session. If 1.5B still misreads, spell the target as
  `"2 working sets of 8 reps at 22.5 kg"` instead of `"22.5 kg x 8"`.
  Source of `currentTarget`: `voice-tools.js get_workout_state` — build it from
  `e.plan`/`e.target` as "<sets> sets of <reps> reps at <weight> <unit>".

## step 3 (bigger, only if CPU can't get there)

Ranked in `docs/VOICE_LLM.md`: Adreno OpenCL backend (~1.5–2×), speculative decoding
(0.5B draft, ~2–3×), Hexagon NPU/QNN (~10×, weeks).

## Key files

| What | Path |
|---|---|
| JNI + KV-prefix cache + timing log | `frontend/android/app/src/main/cpp/voicellm.cpp` |
| CMake (ARM arch flags) | `frontend/android/app/src/main/cpp/CMakeLists.txt` |
| plugin methods (loadModel/generate/download) | `frontend/android/app/src/main/java/ch/duartesantos/opengym/voice/VoiceAssistantPlugin.kt` |
| model catalogue, ChatML, GBNF, makeGenerate | `frontend/src/lib/voice-llm.js` |
| agent loop, system prompt, state snapshot | `frontend/src/lib/voice-llm-agent.js` |
| tool registry (6 query + 12 action) | `frontend/src/lib/voice-tools.js` |
| grammar fallback | `frontend/src/lib/voice-intents.js` |
| mic FAB + spinner + LLM/grammar routing | `frontend/src/components/VoiceButton.jsx` |
| Settings "Voice assistant" card | `frontend/src/views/Settings.jsx` (`VoiceAssistantCard`) |
| architecture + perf notes | `docs/VOICE_LLM.md` |

## Build + deploy (device is connected: `R5CW92J110W`, Galaxy S23+)

```sh
cd ~/Codes/openGym/frontend
VITE_MOBILE=1 VITE_IMG_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/ VITE_GIF_BASE=https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/ npx vite build
npx cap sync android
cd android
JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=~/Library/Android/sdk PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH" ./gradlew :app:assembleDebug --no-daemon -q
~/Library/Android/sdk/platform-tools/adb install -r app/build/outputs/apk/debug/app-debug.apk
```
Note: `npm run build:mobile` fails at the `cap sync` tail (CocoaPods/iOS) — run `vite build`
then `cap sync android` separately.

## Also open (lower priority)
- Stream tokens to the UI instead of one blocking `generate`.
- Confirm-before-destructive tools (`finish_workout`, `swap_exercise`, `remove_set`).
- The regex grammar fallback (`voice-intents.js`) is solid and instant — keep as the path
  while the model loads / on any LLM failure.
