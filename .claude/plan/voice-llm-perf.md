# Voice LLM — state, TODO, next steps

_Last updated 2026-08-31 ~23:00. Branch `voice-m3`, repo `~/Codes/openGym`. Everything below
is UNCOMMITTED unless noted._

---

## TL;DR of where we are

- On-device voice agent (M4) works end-to-end on the S23+.
- Three bugs fixed this session: (a) agent loop never terminated → kept calling tools;
  (b) model auto-loaded at boot → 1–2 GB resident → phone hang / OOM-kill; (c) LFM2
  special tokens weren't parsed in the benchmark.
- **Hammer 2.1 1.5B is now the shipped model (v1.5.0 release APK, installed on device).**
  Wired via `src/lib/voice-llm-formats.js` (`hammer` adapter: own chat template, tools as a
  JSON list, `respond` pseudo-tool, `[{"name","arguments"}]` output, **no GBNF**). The
  benchmark and the app share that adapter module. No native change — `voicellm.cpp`
  already does plain greedy sampling when the grammar string is empty. `runAgent` untouched.
  Benchmark: **43/48 (90%)**, same before and after the wiring refactor.
- `MODELS` now: `hammer2.1-1.5b` (default) + `qwen2.5-3b` (Apache alternate). `qwen2.5-1.5b`
  dropped.
- **v1.5.1 (versionCode 10, on device 2026-08-31 23:06): boot warm-up + KV prime.** With
  voice enabled, `App.jsx` loads the model at boot and calls new `voiceLlm.warm(key)` — a
  1-token pass over the static Hammer prefix (tool list) so `voicellm.cpp`'s KV-prefix reuse
  caches it and the first real command skips ~300 tok of prompt-eval. Model now stays
  resident for the app session. `VoiceButton` only unloads a model **it** loaded
  (`ownsModelRef`) — never the boot one; the 90 s idle-unload is now a no-op when voice is
  enabled. `Settings.enable()` also fires load+warm so toggling on mid-session doesn't need a
  restart; `disable()` still unloads. Verified on S23+: boot trace `voicellm: model loaded`
  → `generate: prompt=4858 chars maxTok=1`, no ANR, TOTAL PSS ~1.7 GB (900 MB dirty weights
  + ~720 MB reclaimable GGUF mmap), SWAP PSS 37 MB — no thrash. APK
  `~/Codes/openGym-personal/Gym-1.5.1-release.apk`.
- Regenerated the FitNotes import backups in **pounds** with routines renamed Upper A /
  Lower A / Upper B / Lower B.
- **2026-08-31: finishers added to the 4 routines (option #1 — no app change).**
  `gen-plan-backup.mjs` now appends each day's "E — FINISHER / CONDITIONING" circuit as a
  trailing superset (`sg` group, `sets` = round count, `prog:'off'`, mixed `reps`/`time`
  modes). Limitation: rest between rounds is the profile's 90s (no per-superset rest in the
  model); Wk4/Wk8 skips are off-sheet. Fresh JSONs regenerated (rohan 391 workouts / 97
  customs, bindu 19 / 32). Both backups + `Gym-1.5.1.apk` pushed to the phone's
  `Download/` for the user to import and forward to Bindu.
- **User must download the Hammer model on device** (Settings → Voice assistant → Download)
  — no GGUF is present after the earlier delete.

---

## Benchmark results (deterministic harness: `clearHistory()` per call + special-token tokenize)

| model | Q4_0 size | score | avg ms (Mac Metal) | license | notes |
|---|---|---|---|---|---|
| Qwen2.5-1.5B (ships as **Fast**) | 0.9 GB | **25%** (12/48) | ~600–1300 | Apache-2.0 | answers from state snapshot, rarely calls tools |
| Qwen2.5-3B (ships as **Smart**) | 1.9 GB | **75%** (36/48) | ~3600 | Apache-2.0 | earlier "83%" was KV-reuse noise; too heavy for S23+ |
| **Hammer2.1-1.5b** | 0.9 GB | **90%** (43/48) | ~1400 | cc-by-nc-4.0 | Qwen2.5-Coder-1.5B + function masking. **The pick.** |
| LFM2-1.2B-Tool | 0.7 GB | **35%** (17/48) | ~1800 | lfm1.0 | special-token fix confirmed (28/48 now call a tool, was 0); 35% is its real score — weak tool selection, defaults to get_workout_state. Out. |

Raw score files: `frontend/scripts/voice-eval/results/scores/`, history in `results/history.jsonl`.

---

## TODO (prioritized)

### 1. Commit the session's work — DONE (branch `voice-m3`, 2026-08-31)
5 commits on `voice-m3`, tests green (voice 59/59; full suite 251 pass):
- `f907ac1` voice: terminate the agent loop + extract the prompt-format module
- `46b7b14` voice: Hammer 2.1 1.5B default, lazy lifecycle, boot warm-up + KV prime
- `1d133c6` voice: offline eval harness — 48 spoken cases through the real GGUF
- `8110210` plan backups: pounds, routine rename, finisher circuits
- (+ this docs/plan commit)
NOT pushed. NOT merged to `personal`. `voice-eval/results/` gitignored.

### 2. Download the Hammer model on device + validate — USER ACTION
- **v1.5.1** release APK installed on the S23+ (versionCode 10, same key, in-place OK).
  Boot trace verified: `voicellm: model loaded` → `generate: prompt=4858 maxTok=1` (the KV
  prime), no ANR, TOTAL PSS ~1.7 GB (900 MB dirty weights + ~720 MB reclaimable GGUF mmap),
  SWAP PSS 37 MB — no thrash.
- User: Settings → Voice assistant → **Download** (Hammer 2.1 1.5B, ~0.9 GB) → turn on.
  With voice enabled the model now warms at **app boot** (not first mic press) and stays
  resident for the session. Tap mic during a workout — first command should be instant.
  `adb -s R5CW92J110W logcat -s voicellm` for the `timing:` line.

### 3. Re-import the backups on both phones — USER ACTION
- Pushed to phone `Download/`: `rohan-backup-2026-08-31.json`, `bindu-backup-2026-08-31.json`,
  `Gym-1.5.1.apk` (Mac copies in `~/Codes/openGym-personal/`). Backups now include the
  **finisher circuits** (trailing supersets per routine).
- User: Settings → Import backup → rohan file (replaces state), THEN any FitNotes CSV
  re-import. Bindu: her JSON + `Gym-1.5.1.apk` on her phone — uninstall any earlier build
  first (signature mismatch).

### 4. Original perf investigation (still open, lower priority now)
- Get the prompt-vs-gen `timing:` split from one device run to know if it's prompt-eval or
  decode bound (prime suspect: GBNF grammar sampler over the 151k vocab). If we move to
  Hammer (no grammar), this may be moot.
- Perf levers ranked in `docs/VOICE_LLM.md`: Adreno OpenCL (~1.5–2×), speculative decoding
  (0.5B draft, ~2–3×), Hexagon NPU/QNN (~10×, weeks).

### 5. Benchmark improvements
- Python CLI + `cases.json` + `models.json` restructure — in progress in that fork.
- Grow `cases.json` over time; each real misfire the user hits → a new case.
- Remaining known misfires (Hammer, 5/48): `get_stats` vs `get_workout_state` confusion,
  "I weigh 77.5" → `set_weight` not `set_bodyweight`, one loop-exhaust on `plan-week`,
  `idle-state` no-tool. Candidate fix: sharpen tool descriptions in `voice-tools.js` +
  the `SHORT` map in `voice-llm-agent.js`.

---

## Next steps to resume (fastest path)

1. Session's work is COMMITTED on `voice-m3` (5 commits, see TODO #1). Not pushed, not
   merged to `personal`. Ask the user before pushing/merging.
2. TODO #2 + #3 are user actions on the phones (download Hammer, import backups, forward
   to Bindu). Nothing to do here until the user reports back.
3. If the user wants circuit support beyond the option-#1 approximation: option #2 is
   `circuit`+`rounds`+`label` on a superset group (~1–2d); option #3 adds a distance mode +
   block AMRAP/EMOM timer + week-conditional entries (~1wk). Neither built.
4. Open perf work: get the prompt-vs-gen `timing:` split from a device run (TODO #4);
   benchmark misfires to chase in TODO #5.

## Key paths

- Agent loop: `frontend/src/lib/voice-llm-agent.js`
- Model bridge / catalogue / grammar: `frontend/src/lib/voice-llm.js` + `voice-llm-format.js`
- Tools: `frontend/src/lib/voice-tools.js` (6 query + 12 action)
- Mic UI + model lifecycle: `frontend/src/components/VoiceButton.jsx`
- Native: `frontend/android/app/src/main/cpp/voicellm.cpp` + `LlamaBridge.kt`
- Benchmark: `frontend/scripts/voice-eval/` (README there)
- Model GGUF cache: `~/Library/Caches/opengym-voice-evals/`
- Personal workspace (APKs, backups, regenerate script): `~/Codes/openGym-personal/`
- Architecture + perf + model notes: `docs/VOICE_LLM.md`
