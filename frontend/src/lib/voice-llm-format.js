// Pure prompt-format helpers for the on-device LLM agent, kept dependency-free so
// they can be reused by the eval harness (scripts/voice-eval.mjs) and unit-tested
// without pulling in @capacitor/core. voice-llm.js re-exports these.

// GBNF: the agent's turn is exactly one JSON object of the shape voice-llm-agent parses.
export const GRAMMAR = String.raw`
root   ::= "{" ws ( tool | say ) ws "}"
tool   ::= "\"tool\"" ws ":" ws string ws "," ws "\"args\"" ws ":" ws object
say    ::= "\"say\"" ws ":" ws string
object ::= "{" ws ( member ( ws "," ws member )* )? ws "}"
member ::= string ws ":" ws value
array  ::= "[" ws ( value ( ws "," ws value )* )? ws "]"
value  ::= string | number | object | array | "true" | "false" | "null"
string ::= "\"" ( [^"\\] | "\\" ["\\/bfnrt] | "\\u" [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] [0-9a-fA-F] )* "\""
number ::= "-"? ( "0" | [1-9] [0-9]* ) ( "." [0-9]+ )? ( [eE] [-+]? [0-9]+ )?
ws     ::= [ \t\n]*
`

// Qwen ChatML. Mirrors the format the native plugin is fed on-device.
export function chatml(system, messages) {
  let s = `<|im_start|>system\n${system}<|im_end|>\n`
  for (const m of messages) {
    if (m.role === 'assistant') s += `<|im_start|>assistant\n${m.content}<|im_end|>\n`
    else if (m.role === 'tool') s += `<|im_start|>user\n[tool_result ${m.name || ''}] ${m.content}<|im_end|>\n`
    else s += `<|im_start|>user\n${m.content}<|im_end|>\n`
  }
  return s + '<|im_start|>assistant\n'
}
