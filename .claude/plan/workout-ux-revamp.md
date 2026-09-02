# Workout-screen UX revamp — status + resume

_Last updated 2026-09-01. Branch `workout-ux` (4 commits on `personal` @ `975e016`).
NOT merged, NOT pushed. Classification: **frontend-only** (+ 1 version-bump line)._

## Status: implemented, awaiting device feedback

Both stages built and committed. Full suite 264 pass, `vite build` clean. APK
`Gym-1.7.0-release.apk` (versionCode 12) cut and sent to the user — personal-signed,
installs over 1.6.0/1.5.1 in place.

### Commits on `workout-ux`
- `c34c58f` stage 1 — typeable weight field + smarter working-weight default + focus groundwork
- `521b962` stage 2 — one-exercise pager + pill strip + one-set-at-a-time logging
- `ab088c1` voice FAB lifts above the rest timer (was covering Skip)
- `25c1dee` release bump 1.7.0 / versionCode 12

### What shipped
- **`WeightInput`** (`sheets.jsx` ~65) — the big readout is now a real `NumberField`
  (`className="bw-num"`, CSS `field-sizing:content`). Used by 3 sheets: pre-workout
  weigh-in, working-weight confirm (`TopWeight`), goal sheet.
- **`TopWeight` default** (`sheets.jsx` ~863) — `maxSet` (today's heaviest done set) →
  `entry.plan?.weight` (what progression prescribed this session) → `exWeights[id].w`
  (last kept working weight) → `entry.target.weight`. Dropped all-time `bestWeightFor`
  from the default; it still feeds the "new record" line.
- **`ExerciseBlock` `focus` mode** (`Workout.jsx` ~57) — done sets collapse to a
  `.setdone-list` (tap a row to reopen); current set gets `.cfgrow.setbig` fields
  (52×58 steppers, 26px value) + full-width "Log set" (`onToggle(curI)`). Effort is its
  own `.setbig` row. `showAll` local state toggles the old grid ("All sets" ⇄ "Current set").
- **Superset/circuit pager** (`Workout.jsx` ActiveWorkout render ~352) — `.ss-pills`
  strip (tap to `setPickK(k)`); one `<ExerciseBlock focus key={shown}>` for
  `shownK = pickK ?? activeK`; `activeK` = member with fewest done sets, earliest.
  `useEffect(() => setPickK(null), [activeK, unitIdx])`. Circuit round controls unchanged.
- Single (non-superset) exercises use the same `focus` view, no pills.
- **Voice FAB** (`VoiceButton.jsx` `<style>`) — `body.resting .vb-fab{bottom:...+200px}`
  and same for `.vb-bubble`, so the mic clears the rest/work timer.
- Removed the stage-1 `.ss-ex.active/.idle` accent-bar approach (superseded by the pager).

## To resume

1. **User is device-testing 1.7.0.** Iterate on feedback via the dev server
   (`localhost:5173`, tmux session `dev`, HMR). Web build = guest mode; state persists in
   localStorage. To reload the user's data: `cp ~/Codes/openGym-personal/rohan-backup-2026-08-31.json frontend/public/_seed.json`
   then in the browser console:
   `fetch('/_seed.json').then(r=>r.json()).then(s=>{localStorage.setItem('gym_state_v1',JSON.stringify(s));localStorage.setItem('gym_guest','1');location.reload()})`
   — **delete `public/_seed.json` before any APK build** (it gets bundled, see instinct
   `vite-public-dir-leaks-into-apk`). The rohan backup has 4 supersets/routine, no circuits
   (predates the feature) — "Make circuit" on a trailing group in RoutineEdit to test the
   circuit pager.
2. **When the user greenlights:** `git checkout personal && git merge --ff-only workout-ux
   && git push origin personal`, then delete `workout-ux` (local). Same flow as the 1.6.0
   merge.
3. Possible stage-2 polish depending on feedback: `.setbig` fields may be tight at 375px
   (52px buttons × 2 + value); effort as a chip row instead of a stepper; "up next"
   preview of the next pill's target during rest.

## Key paths
- `frontend/src/views/Workout.jsx` — `ExerciseBlock`, `ActiveWorkout`
- `frontend/src/sheets.jsx` — `WeightInput`, `TopWeight`, `BwSheet`
- `frontend/src/components/VoiceButton.jsx` — FAB `<style>`
- `frontend/src/index.css` — `.ss-pills`, `.ss-pill`, `.setdone*`, `.setnow-hd`,
  `.cfgrow.setbig`, `.bw-num`
