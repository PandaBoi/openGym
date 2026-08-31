# Fork notes — personal openGym (Rohan)

Personal fork of [arvids-unavailable/openGym](https://github.com/arvids-unavailable/openGym)
(AGPL-3.0). Android-only, on-device (`VITE_MOBILE`) build, sideloaded. No self-hosted server.
Long-term goal: FitNotes migration + a push-to-talk on-device voice agent.

## Remotes / branches

- `origin` → `github.com/PandaBoi/openGym` (this fork)
- `upstream` → `github.com/arvids-unavailable/openGym` (original; pull fixes with
  `git fetch upstream && git merge upstream/main`)
- Work happens on branch **`personal`**.

## Changes so far (Milestone 1)

- **App id renamed** so it never collides with the official openGym APK on a phone:
  `ch.duartesantos.opengym` → `com.rohanpanda.opengym`.
  - `frontend/capacitor.config.json` (`appId`)
  - `frontend/android/app/build.gradle` (`applicationId`; `namespace` left as-is on purpose —
    it only affects the generated `BuildConfig`/`R` package, and changing it would force
    renaming the Java source tree)
  - `frontend/android/app/src/main/res/values/strings.xml` (`package_name`, `custom_url_scheme`)
  - Launcher label still shows "openGym" (`app_name` unchanged).
- **Release signing** wired up in `frontend/android/app/build.gradle`: reads
  `frontend/android/keystore.properties` if present, else builds unsigned. Both the properties
  file and `*.jks`/`*.keystore` are gitignored.
- Added `frontend/.gitignore` (upstream has none for `node_modules` / `dist`).

## Local build environment (macOS, this machine)

Not on PATH by default — export before building:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=$HOME/Library/Android/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Installed for the build: `platforms;android-35`, `build-tools;35.0.0` (via `sdkmanager`).
`frontend/android/local.properties` holds `sdk.dir=` (gitignored).
NDK + cmake are **not** installed yet — needed later for the voice plugin (Milestone 3+).

## Build commands

```sh
cd frontend
npm install
npm run build:mobile        # vite build (VITE_MOBILE=1) + cap sync; the `cap sync` tail also
                            # tries iOS and errors on "CocoaPods is not installed" — harmless,
                            # or run the web build then `npx cap sync android` directly.
npx cap sync android

cd android
./gradlew :app:assembleDebug      # -> app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease    # -> app/build/outputs/apk/release/app-release.apk  (signed)
```

Install on a USB-connected phone: `adb install -r <apk>`.

## Signing keystore — IMPORTANT

`frontend/android/opengym-personal.jks` (gitignored). **Keep this file and its password
backed up somewhere safe.** Every future APK update must be signed with the same key or
Android refuses to install it over the existing app.

- alias: `opengym`
- store/key password: `opengym-personal` (change it if you care; update `keystore.properties`)
- validity: 30 years

## Releasing an update

Bump all three in step, then `assembleRelease`:

- `frontend/android/app/build.gradle` — `versionCode` (must strictly increase), `versionName`
- `frontend/package.json` — `version`

## Roadmap

See `~/.claude/plans/fancy-spinning-pond.md` for the full plan. Next:

- **Milestone 1 remainder**: install on both phones; export FitNotes CSV
  (`FitNotes → Settings → Export Data → CSV`), import via `Settings → Import from another app`.
- **Milestone 2**: turn the 2-month training plan into routines + weekly schedule.
- **Milestone 3+**: native Capacitor voice plugin (whisper.cpp STT, Android TTS), then
  on-device llama.cpp agent loop with tool calls into the workout store.
