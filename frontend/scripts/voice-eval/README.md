# Voice-agent benchmark

Scores how often the on-device LLM agent picks the **right tool and answer** for a fixed
set of spoken commands. Run it before/after any change to the system prompt
(`buildSystemPrompt`), the state snapshot (`stateSnapshot`), the grammar, the tool
descriptions, or the model.

The test set is **data** (`cases.json`) and the model list is **config** (`models.json`),
so both grow over time without touching code. A Python CLI (`run.py`) drives everything
and owns grading + score history; a thin Node worker (`worker.mjs`) owns the parts that
have to stay in JS — the real `runAgent` loop, the workout tools, the Zustand store, and
the GGUF via `node-llama-cpp`.

## Run

```bash
npm run eval:voice                              # every model in models.json whose GGUF exists
python3 scripts/voice-eval/run.py hammer2.1-1.5b
python3 scripts/voice-eval/run.py qwen2.5-1.5b qwen2.5-3b --only log-   # subset of cases
python3 scripts/voice-eval/run.py --list                               # registry + which files are present
python3 scripts/voice-eval/run.py hammer2.1-1.5b --save                # write a score file + history line
python3 scripts/voice-eval/run.py --compare qwen2.5-1.5b hammer2.1-1.5b # diff latest saved scores
```

No Python deps — stdlib only. Node ≥ 20 + `node-llama-cpp` (already a devDependency).

## Files

| file | what |
|---|---|
| `cases.json` | **the benchmark set** — `{id, state, transcript, expect}`, pure data |
| `models.json` | **model registry** — name → `{path, format, n_ctx, note, download}` |
| `run.py` | CLI: resolve models, drive the worker, grade, scoreboard, save/compare |
| `grade.py` | pure grader — the `expect` matcher schema; no I/O |
| `worker.mjs` | Node bridge — seeds a fixture, runs `runAgent` per case, emits raw traces |
| `_node-loader.mjs` | lets `worker.mjs` import the app's modules outside Vite (glob/env rewrite + `sheets.jsx` stub) |
| `fixtures.js` | deterministic store state — `base` (live workout) / `idle` (no workout) |
| `formats.js` | per-model prompt/parse adapters: `chatml` (ours + GBNF), `hammer`, `lfm2-tool` |
| `backend-llama.js` | loads a GGUF, `clearHistory()` per call (fresh KV, deterministic), runs it through a format |
| `results/traces/` | last raw traces per model (gitignored) |
| `results/scores/` | `--save` snapshots (gitignored) |
| `results/history.jsonl` | one line per saved run (gitignored) |

## Adding a test case

Append to `cases.json`:

```json
{ "id": "log-explicit", "state": "base",
  "transcript": "log eight reps at seventy kilos",
  "expect": {
    "tool": "log_set",
    "args": { "log_set": { "reps": 8, "weight": 70 } }
  } }
```

### `expect` matchers (all optional)

| key | meaning |
|---|---|
| `tool` | this tool name must appear among the calls |
| `tools` | `[names]` — must appear as an ordered subsequence of the calls |
| `no_tool` | `true` — the agent must answer directly (clarify / decline) |
| `args` | `{tool: {field: MATCHER}}` — checked against that tool's first call |
| `say_matches` / `say_not_matches` | regex on the spoken answer (`say_flags: "i"` for ignore-case) |
| `answer_non_empty` | force the non-empty check (also implied when nothing else pins the answer) |

Every answer-expecting case also silently checks the agent didn't bail out of the loop
(`exhausted`).

**MATCHER** is a number (abs diff < 0.01), a string (exact), or one of
`{"regex": "...", "flags": "i"}` · `{"min_len": N}` · `{"oneof": [...]}`.

`state` is `base` (default) or `idle` — defined in `fixtures.js`. Add a new fixture there
and reference it by name.

## Adding a model

Append to `models.json` under `models`. `path` may use `{cache}` (→ `cache_dir`), `~`, and
`$ENV`. `format` is a key in `formats.js`:

- `chatml` — our `{"tool"|"say"}` JSON + GBNF grammar (Qwen2.5, Qwen3, any ChatML instruct)
- `hammer` — Hammer's task template, tools as a JSON list, a `respond` pseudo-tool, output
  parsed as `[{"name","arguments"}]`, no grammar
- `lfm2-tool` — LFM2's `<|tool_list_start|>` schema, Pythonic `[fn(a=b)]` call output

A new model with a novel output shape needs a new adapter in `formats.js` (each is
`{buildPrompt, grammar, parse}`).

## How scoring maps to shipping

`chatml` is byte-identical to what the app ships (`src/lib/voice-llm-format.js`). The
`hammer` / `lfm2-tool` adapters are benchmark-only — shipping one of those models means
porting its adapter into `voice-llm.js` + `voice-llm-agent.js` + `cpp/voicellm.cpp`.
See `docs/VOICE_LLM.md`.
