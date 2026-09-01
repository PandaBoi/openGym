"""Pure grader for the voice benchmark.

Takes a case's declarative ``expect`` block (from cases.json) and one trace produced by
worker.mjs, returns {"passed": bool, "checks": [{"name","ok","detail"}]}.

Matcher schema (all keys optional):
  tool              str   - this tool name must appear among the called tools
  tools             [str] - must appear as an ordered subsequence of the called tools
  no_tool           bool  - no tool may be called (clarify / decline)
  args              {tool: {field: MATCHER}} - checked against that tool's first call
  say_matches       regex - the spoken answer must match (say_flags: "i" for ign're-case)
  say_not_matches   regex - the spoken answer must NOT match
  answer_non_empty  bool  - force the non-empty check (also implied when nothing else
                            pins the answer)

MATCHER: a number (abs diff < 0.01), a string (exact), or one of
  {"regex": "...", "flags": "i"}   {"min_len": N}   {"oneof": [...]}
"""
import json
import re


def _rx_flags(spec):
    return re.I if "i" in (spec or "") else 0


def _match(expected, actual):
    if isinstance(expected, dict):
        if "regex" in expected:
            return actual is not None and re.search(
                expected["regex"], str(actual), _rx_flags(expected.get("flags"))
            ) is not None
        if "min_len" in expected:
            return isinstance(actual, str) and len(actual) >= expected["min_len"]
        if "oneof" in expected:
            return actual in expected["oneof"]
        return False
    if isinstance(expected, bool):
        return actual == expected
    if isinstance(expected, (int, float)):
        try:
            return actual is not None and abs(float(actual) - float(expected)) < 0.01
        except (TypeError, ValueError):
            return False
    return actual == expected


def _is_subsequence(want, got):
    i = 0
    for g in got:
        if i < len(want) and g == want[i]:
            i += 1
    return i == len(want)


def grade(expect, tc):
    checks = []

    def add(name, ok, detail=""):
        checks.append({"name": name, "ok": bool(ok), "detail": str(detail)})

    tools = tc.get("tools", [])
    calls = tc.get("calls", [])
    speak = tc.get("speak") or ""

    def args_of(tool):
        for c in calls:
            if c.get("tool") == tool:
                return c.get("args", {})
        return None

    if expect.get("no_tool"):
        add("no tool call", len(tools) == 0, f"called: {tools}")

    if "tool" in expect:
        add(f"calls {expect['tool']}", expect["tool"] in tools, f"called: {tools}")

    if "tools" in expect:
        add("calls " + " -> ".join(expect["tools"]),
            _is_subsequence(expect["tools"], tools), f"called: {tools}")

    for tool, fields in (expect.get("args") or {}).items():
        a = args_of(tool)
        if a is None:
            add(f"{tool} args", False, "(tool not called)")
        else:
            for field, matcher in fields.items():
                add(f"{tool}.{field}", _match(matcher, a.get(field)), json.dumps(a))

    if "say_matches" in expect:
        ok = re.search(expect["say_matches"], speak, _rx_flags(expect.get("say_flags"))) is not None
        add(f"say ~ /{expect['say_matches']}/", ok, repr(speak))
    if "say_not_matches" in expect:
        ok = re.search(expect["say_not_matches"], speak, _rx_flags(expect.get("say_flags"))) is None
        add(f"say !~ /{expect['say_not_matches']}/", ok, repr(speak))

    pins_answer = expect.get("no_tool") or "tool" in expect or "tools" in expect
    if expect.get("answer_non_empty") or not pins_answer:
        add("answer non-empty", len(speak.strip()) > 0, repr(speak))

    if not expect.get("no_tool"):
        add("agent produced an answer", not tc.get("exhausted"),
            "exhausted" if tc.get("exhausted") else "ok")

    return {"passed": all(c["ok"] for c in checks), "checks": checks}


def score_run(cases, traces):
    """cases: list from cases.json; traces: list from worker.mjs. -> summary dict."""
    by_id = {t["id"]: t for t in traces}
    rows = []
    for c in cases:
        tc = by_id.get(c["id"])
        if tc is None:
            continue
        g = grade(c.get("expect", {}), tc)
        rows.append({
            "id": c["id"],
            "passed": g["passed"],
            "checks": g["checks"],
            "tools": tc.get("tools", []),
            "speak": tc.get("speak", ""),
            "ms": tc.get("ms", 0),
            "exhausted": tc.get("exhausted", False),
            "error": tc.get("error"),
        })
    passed = sum(1 for r in rows if r["passed"])
    return {
        "total": len(rows),
        "passed": passed,
        "rate": (passed / len(rows)) if rows else 0.0,
        "avg_ms": round(sum(r["ms"] for r in rows) / len(rows)) if rows else 0,
        "cases": rows,
    }
