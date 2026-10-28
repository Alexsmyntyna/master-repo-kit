import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401
from fixtures import (PROJECT, codex_custom_call, codex_function_call, codex_message, codex_meta,
                      codex_output, make_config, write_jsonl)
from transcript_sources import CodexSource, codex_patch_paths

PATCH = ("*** Begin Patch\n*** Update File: /work/demo/a.py\n@@\n-x\n+y\n"
         "*** Add File: /work/demo/new.py\n+z\n*** Delete File: /work/demo/old.py\n*** End Patch")


class CodexSourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.source = CodexSource(make_config(self.tmp))

    def load(self, records, **meta):
        path = write_jsonl(self.tmp / "codex" / "2026" / "01" / "01" / "rollout-x.jsonl",
                           [codex_meta("sess-1", "2026-01-01T10:00:00Z", **meta), *records])
        refs = self.source.discover([PROJECT])
        return self.source.load(refs[0]) if refs else None

    def test_owner_turn_kept_and_injected_content_filtered(self):
        session = self.load([
            codex_message("developer", ["<permissions instructions>"], "2026-01-01T10:00:01Z"),
            codex_message("user", ["# AGENTS.md instructions for /work/demo", "<environment_context>\n<cwd>/work/demo</cwd>"],
                          "2026-01-01T10:00:02Z"),
            codex_message("user", ["<image name=[Image #1]>", "what does this show?", "</image>"], "2026-01-01T10:00:03Z"),
            codex_message("assistant", ["checking"], "2026-01-01T10:00:04Z", phase="commentary"),
            codex_message("assistant", ["It shows a chart."], "2026-01-01T10:00:05Z", phase="final_answer"),
        ])
        self.assertEqual([e.owner_text for e in session.exchanges], ["what does this show?"])
        self.assertEqual(session.exchanges[0].final_reply, "It shows a chart.")

    def test_apply_patch_paths_from_raw_and_js_wrapped_forms(self):
        self.assertEqual(codex_patch_paths(PATCH), ["/work/demo/a.py", "/work/demo/new.py", "/work/demo/old.py"])
        wrapped = 'const patch = ' + __import__("json").dumps(PATCH) + ';\ntext(await tools.apply_patch(patch));'
        self.assertEqual(codex_patch_paths(wrapped), ["/work/demo/a.py", "/work/demo/new.py", "/work/demo/old.py"])

        session = self.load([
            codex_message("user", ["edit please"], "2026-01-01T10:00:01Z"),
            codex_custom_call("exec", wrapped, "2026-01-01T10:00:02Z", "c1"),
            codex_custom_call("apply_patch", PATCH, "2026-01-01T10:00:03Z", "c2"),
        ])
        self.assertEqual(session.exchanges[0].edited_files, ["/work/demo/a.py", "/work/demo/new.py", "/work/demo/old.py"])

    def test_commands_subagents_denials_and_interrupts(self):
        session = self.load([
            codex_message("user", ["run things"], "2026-01-01T10:00:01Z"),
            codex_function_call("exec_command", {"cmd": "ls -la"}, "2026-01-01T10:00:02Z", "c1"),
            codex_custom_call("exec", 'text(await tools.exec_command({cmd:"git status"}));', "2026-01-01T10:00:03Z", "c2"),
            codex_function_call("spawn_agent", {"task_name": "worker_one", "message": "enc"}, "2026-01-01T10:00:04Z", "c3"),
            codex_output('exec_command failed: CreateProcess { message: "Rejected(\\"no\\")" }', "2026-01-01T10:00:05Z", "c1"),
            {"type": "event_msg", "timestamp": "2026-01-01T10:00:06Z", "payload": {"type": "turn_aborted", "reason": "interrupted"}},
        ])
        exchange = session.exchanges[0]
        self.assertEqual((exchange.command_count, exchange.commands), (2, ["ls -la", "git status"]))
        self.assertEqual(exchange.subagents, ["worker_one"])
        self.assertEqual(exchange.denials, ["ls -la"])
        self.assertTrue(exchange.interrupted)

    def test_subagent_and_exec_sessions_are_not_owner_sessions(self):
        self.assertIsNone(self.load([codex_message("user", ["x"], "2026-01-01T10:00:01Z")], thread_source="subagent"))
        self.assertIsNone(self.load([codex_message("user", ["x"], "2026-01-01T10:00:01Z")], source="exec"))


if __name__ == "__main__":
    unittest.main()
