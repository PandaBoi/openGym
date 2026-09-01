// Mobile build (VITE_MOBILE=1) — the standalone app-store version (Capacitor native shell).
//
// There is no backend: nothing to sign in to, everything lives on the phone. Unlike guest
// mode in a browser, this is the user's only copy of their training log, so it can't depend
// on WebView localStorage alone (iOS evicts that under storage pressure). Every persist()
// therefore also lands in a JSON file in the app's private data directory, and boot()
// restores from it. The workout reminder uses native local notifications scheduled per
// planned weekday — no server involved, unlike Web Push in the self-hosted version.
//
// Like the demo build, MOBILE is replaced at build time, so all of this folds away in
// web bundles; the Capacitor plugins are only ever imported behind it.
import { t } from './i18n.js'

export const MOBILE = import.meta.env.VITE_MOBILE === '1'

const FILE = 'opengym-state.json'

export async function nativeLoad() {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 })
    return JSON.parse(r.data)
  } catch (e) { return null }   // first launch, or unreadable — localStorage copy takes over
}

export async function nativeSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.writeFile({ path: FILE, directory: Directory.Data, data: JSON.stringify(state), encoding: Encoding.UTF8 })
  } catch (e) { /* keep the localStorage copy */ }
}

// A second, sturdier copy of the state in the shared Documents directory. The Directory.Data
// mirror above is wiped whenever the app is uninstalled (a signing-key change forces that)
// or the WebView's data is cleared on an OS update — the failure modes that have actually
// lost a training log. Documents survives both. boot() falls back to CHECKPOINT (then its
// one-generation-old CHECKPOINT_PREV) only when localStorage and the Data mirror both come
// up empty, so it can never clobber a live log — it just refills a blank install.
const CHECKPOINT = 'opengym-checkpoint.json'
const CHECKPOINT_PREV = 'opengym-checkpoint-prev.json'

export async function checkpointSave(state) {
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const opt = { directory: Directory.Documents, encoding: Encoding.UTF8 }
    // rotate the current checkpoint to -prev first, so a truncated write is never the only copy
    try {
      const cur = await Filesystem.readFile({ path: CHECKPOINT, ...opt })
      await Filesystem.writeFile({ path: CHECKPOINT_PREV, data: cur.data, ...opt })
    } catch (e) { /* first checkpoint — nothing to rotate */ }
    await Filesystem.writeFile({ path: CHECKPOINT, data: JSON.stringify(state), ...opt })
    return true
  } catch (e) { return false }
}

export async function checkpointLoad() {
  const read = async name => {
    try {
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
      const r = await Filesystem.readFile({ path: name, directory: Directory.Documents, encoding: Encoding.UTF8 })
      const s = JSON.parse(r.data)
      return s && typeof s === 'object' ? s : null
    } catch (e) { return null }
  }
  return (await read(CHECKPOINT)) || (await read(CHECKPOINT_PREV))
}

// (Re)schedule the workout-day reminder: one repeating notification per weekday that has a
// routine in the weekly plan. Cheap enough to run after any state change — the plan or the
// reminder time may just have been edited. `interactive` gates the OS permission prompt to
// the Settings toggle; a background resync never pops a dialog.
export async function syncReminder(S, interactive = false) {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: [0, 1, 2, 3, 4, 5, 6].map(d => ({ id: 100 + d })) }).catch(() => {})
    const r = S.reminder
    if (!r?.on) return true
    let perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted' && interactive) perm = await LocalNotifications.requestPermissions()
    if (perm.display !== 'granted') return false
    const [hour, minute] = (r.time || '08:00').split(':').map(Number)
    const notifications = Object.entries(S.week || {})
      .filter(([, rid]) => rid && (S.routines || []).some(x => x.id === rid))
      .map(([day, rid]) => ({
        id: 100 + Number(day),
        title: t('Workout day'),
        body: t('{0} is on the plan today — let’s go!', S.routines.find(x => x.id === rid).name),
        // Capacitor weekdays are 1 (Sunday) … 7 (Saturday); S.week uses getDay() 0…6.
        schedule: { on: { weekday: Number(day) + 1, hour, minute }, allowWhileIdle: true },
      }))
    if (notifications.length) await LocalNotifications.schedule({ notifications })
    return true
  } catch (e) { return false }
}

// WKWebView can't do blob-URL downloads, so the backup goes out through the OS share sheet
// (Files, AirDrop, mail, …) from a temp file instead.
export async function shareExport(json, filename) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const w = await Filesystem.writeFile({ path: filename, directory: Directory.Cache, data: json, encoding: Encoding.UTF8 })
  await Share.share({ title: filename, url: w.uri })
}
