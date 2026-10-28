import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401
import activity_log
import notepad
from _paths import TOOLS_DIR

HOOKS = TOOLS_DIR / "hooks"


def run_hook(script: str, payload, *args, cwd=None, env=None) -> subprocess.CompletedProcess:
    stdin = payload if isinstance(payload, str) else json.dumps(payload)
    return subprocess.run([sys.executable, str(HOOKS / script), *args], input=stdin, capture_output=True, text=True,
                          timeout=30, cwd=cwd, env=env)


class HookCase(unittest.TestCase):
    def setUp(self):
        self.repo = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(lambda: shutil.rmtree(self.repo, ignore_errors=True))
        (self.repo / ".git").mkdir()
        self.log = self.repo / "context-notepad" / "activity.jsonl"


class LogSubagentTests(HookCase):
    def test_claude_start_and_stop_log_launch_then_done_under_a_session_entry(self):
        base = {"session_id": "s1", "agent_id": "a1", "agent_type": "Explore", "cwd": str(self.repo)}
        start = run_hook("log_subagent.py", {**base, "hook_event_name": "SubagentStart"}, "--agent", "claude")
        stop = run_hook("log_subagent.py", {**base, "hook_event_name": "SubagentStop",
                                            "last_assistant_message": "Found it.\nDetails"}, "--agent", "claude")
        self.assertEqual((start.returncode, stop.returncode, start.stdout, stop.stdout), (0, 0, "", ""))
        entries = activity_log.read_entries(self.log)
        self.assertEqual([e["event"] for e in entries], ["session_start", "subagent_launch", "subagent_done"])
        self.assertEqual(entries[1]["parent"], entries[0]["id"])
        self.assertEqual(entries[2]["parent"], entries[1]["id"])
        self.assertEqual(entries[2]["bullets"], ["Found it."])

    def test_codex_spawn_agent_pre_tool_use_logs_task_name_and_model(self):
        payload = {"hook_event_name": "PreToolUse", "tool_name": "spawn_agent", "tool_use_id": "tu1", "session_id": "c1",
                   "cwd": str(self.repo), "tool_input": {"task_name": "worker", "model": "m-1", "message": "Do X\nthen Y"}}
        self.assertEqual(run_hook("log_subagent.py", payload, "--agent", "codex").returncode, 0)
        launch = activity_log.read_entries(self.log)[-1]
        self.assertEqual((launch["agent"], launch["title"], launch["model"], launch["bullets"]), ("codex", "worker", "m-1", ["Do X"]))

    def test_other_tools_are_ignored(self):
        payload = {"hook_event_name": "PreToolUse", "tool_name": "shell", "session_id": "c1", "cwd": str(self.repo)}
        run_hook("log_subagent.py", payload, "--agent", "codex")
        self.assertFalse(self.log.exists())

    def test_garbage_input_and_unwritable_log_still_exit_zero_silently(self):
        (self.repo / "context-notepad").write_text("a file where the folder should be")
        result = run_hook("log_subagent.py", {"hook_event_name": "SubagentStart", "session_id": "s", "cwd": str(self.repo)})
        self.assertEqual((result.returncode, result.stdout), (0, ""))
        for stdin in ("not json", ""):
            self.assertEqual(run_hook("log_subagent.py", stdin, cwd=self.repo).returncode, 0)

    def test_errors_are_written_to_a_log_file(self):
        self.log.mkdir(parents=True)  # appending to a directory fails
        run_hook("log_subagent.py", {"hook_event_name": "SubagentStart", "session_id": "s", "cwd": str(self.repo)})
        self.assertIn("Traceback", (self.log.parent / "hook-errors.log").read_text())


class ContextReminderTests(HookCase):
    def transcript(self, tokens: int) -> Path:
        record = {"type": "assistant", "isSidechain": False,
                  "message": {"usage": {"input_tokens": 2, "cache_read_input_tokens": tokens - 2, "cache_creation_input_tokens": 0}}}
        path = self.repo / "session.jsonl"
        path.write_text(json.dumps(record) + "\n")
        return path

    def payload(self, tokens: int) -> dict:
        return {"hook_event_name": "UserPromptSubmit", "cwd": str(self.repo), "transcript_path": str(self.transcript(tokens))}

    def test_above_threshold_emits_one_factual_line_naming_open_items(self):
        root = self.repo / "context-notepad" / "threads"
        path = root / "demo" / "notepad.md"
        path.parent.mkdir(parents=True)
        text = notepad.skeleton("Demo", "demo", "2026-10-01")
        for item in ("a", "b", "c", "d"):
            text = notepad.append_to_section(text, "Next", f"- [ ] N{'abcd'.index(item) + 1} {item}")
        path.write_text(text)

        result = run_hook("context_reminder.py", self.payload(182_000))
        self.assertEqual(result.returncode, 0)
        output = json.loads(result.stdout)["hookSpecificOutput"]
        self.assertEqual(output["hookEventName"], "UserPromptSubmit")
        self.assertEqual(output["additionalContext"],
                         "Context is at 182K tokens (target 150K, hard limit 200K); thread demo has 4 open items.")

    def test_reminder_repeats_only_after_the_context_grows_a_step(self):
        env = {**__import__("os").environ, "CONTEXT_NOTEPAD_STATE_DIR": str(self.repo / "state")}
        outputs = []
        for tokens in (182_000, 185_000, 193_000):
            payload = {**self.payload(tokens), "session_id": "s1"}
            outputs.append(run_hook("context_reminder.py", payload, cwd=self.repo, env=env).stdout)
        self.assertEqual([bool(out) for out in outputs], [True, False, True])

    def test_session_id_cannot_escape_the_state_dir_and_a_symlinked_dir_is_not_used(self):
        state = self.repo / "state"
        env = {**__import__("os").environ, "CONTEXT_NOTEPAD_STATE_DIR": str(state)}
        payload = {**self.payload(182_000), "session_id": "../../escape"}
        run_hook("context_reminder.py", payload, cwd=self.repo, env=env)
        self.assertEqual([p.parent for p in self.repo.rglob("*escape*")], [state])
        self.assertEqual(state.stat().st_mode & 0o777, 0o700)

        elsewhere = self.repo / "elsewhere"
        elsewhere.mkdir()
        linked = self.repo / "linked"
        linked.symlink_to(elsewhere)
        env["CONTEXT_NOTEPAD_STATE_DIR"] = str(linked)
        payload["session_id"] = "s2"
        result = run_hook("context_reminder.py", payload, cwd=self.repo, env=env)
        self.assertEqual(result.returncode, 0)
        self.assertTrue(result.stdout)  # still reminds, just without dedupe
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_below_threshold_and_bad_input_print_nothing_and_exit_zero(self):
        for payload in (self.payload(120_000), "garbage", {"transcript_path": "/nonexistent"}):
            result = run_hook("context_reminder.py", payload, cwd=self.repo)
            self.assertEqual((result.returncode, result.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
