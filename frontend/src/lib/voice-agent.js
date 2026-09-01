// Milestone 3 dispatcher — maps one parsed { intent, args } to one tool in voice-tools.js
// and returns a short line to speak. Milestone 4's LLM agent uses the same tools directly.

import { exOr } from './exercises.js'
import { ctx, activeEntryIdx, runTool } from './voice-tools.js'
import { fmtNum } from './format.js'

const curExerciseName = () => {
  const c = ctx()
  if (!c) return null
  return exOr(c.A.entries[activeEntryIdx(c)].id).n
}

const HELP = 'Try: log 8 reps at 60 kilos · next exercise · start rest · what\'s my target · finish workout.'

export function runIntent({ intent, args = {} }) {
  switch (intent) {
    case 'log_set': return runTool('log_set', args).message
    case 'mark_done': return runTool('log_set', {}).message
    case 'set_weight': return runTool('set_weight', args).message
    case 'set_reps': return runTool('set_reps', args).message
    case 'add_set': return runTool('add_set').message
    case 'remove_set': return runTool('remove_set').message
    case 'next_exercise': return runTool('next_exercise').message
    case 'prev_exercise': return runTool('prev_exercise').message
    case 'start_rest': return runTool('start_rest', args).message
    case 'stop_rest': return runTool('stop_rest').message
    case 'swap_exercise': return runTool('swap_exercise', args).message
    case 'set_bodyweight': return runTool('set_bodyweight', args).message

    case 'whats_target': {
      const st = runTool('get_workout_state')
      return st.active ? `${st.currentExercise}: ${st.currentTarget}.` : 'No workout is running.'
    }
    case 'how_many_sets': {
      const st = runTool('get_workout_state')
      return st.active
        ? `${st.setsDone} of ${st.setsTotal} sets done, exercise ${st.exerciseIndex} of ${st.exerciseCount}.`
        : 'No workout is running.'
    }
    case 'last_time': {
      const name = curExerciseName()
      if (!name) return 'No workout is running.'
      const h = runTool('get_exercise_history', { exercise: name, weeks: 12 })
      if (!h.sessions?.length) return `No history for ${name} yet.`
      const last = h.sessions[h.sessions.length - 1]
      return `Last ${name} (${last.date}): ${last.sets.map(s => `${fmtNum(s.weight || 0)}x${s.reps}`).join(', ')}.`
    }
    case 'finish_workout': return runTool('finish_workout').message

    case 'cancel': return 'Okay.'
    case 'empty': return "I didn't hear anything."
    default: return "I didn't catch that. " + HELP
  }
}
