// The benchmark drives the SAME adapters the app ships — one source of truth so a score
// here reflects exactly what runs on the phone. See src/lib/voice-llm-formats.js.
//
// This shim keeps the local import path and the old `formatForModel` name.
export { FORMATS, formatForFile as formatForModel } from '../../src/lib/voice-llm-formats.js'
