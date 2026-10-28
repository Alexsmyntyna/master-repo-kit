import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401
from fixtures import (PROJECT, claude_assistant, claude_tool_result, claude_user, make_config,
                      text_block, tool_use, write_jsonl)
from transcript_sources import ClaudeCodeSource, drop_replayed_exchanges


class ClaudeSourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))
        self.source = ClaudeCodeSource(make_config(self.tmp))

    def load(self, records, name="s1"):
        path = write_jsonl(self.tmp / "claude" / "-work-demo" / f"{name}.jsonl", records)
        refs = [r for r in self.source.discover([PROJECT]) if r.path == path]
        return self.source.load(refs[0])

    def test_only_typed_owner_turns_become_exchanges(self):
        session = self.load([
            claude_user("real request", "2026-01-01T10:00:00Z"),
            claude_user("agent-written brief", "2026-01-01T10:01:00Z", isSidechain=True),
            claude_user("<system-reminder>injected</system-reminder>", "2026-01-01T10:02:00Z"),
            claude_user("tool chatter", "2026-01-01T10:03:00Z", isMeta=True),
            claude_user("done", "2026-01-01T10:04:00Z", promptSource="system", turnOrigin="task_notification"),
        ])
        self.assertEqual([e.owner_text for e in session.exchanges], ["real request"])

    def test_message_sent_mid_turn_is_an_owner_turn(self):
        queued = {"type": "attachment", "cwd": "/work/demo", "timestamp": "2026-01-01T10:01:00Z",
                  "attachment": {"type": "queued_command", "prompt": "also put it in docs",
                                 "humanTurn": True, "timestamp": "2026-01-01T10:01:00Z"}}
        session = self.load([claude_user("real request", "2026-01-01T10:00:00Z"), queued])
        self.assertEqual([e.owner_text for e in session.exchanges], ["real request", "also put it in docs"])
        self.assertTrue(session.exchanges[1].sent_mid_turn)

    def test_queued_message_whose_prompt_is_a_list_of_blocks_is_read(self):
        queued = {"type": "attachment", "cwd": "/work/demo", "timestamp": "2026-01-01T10:01:00Z",
                  "attachment": {"type": "queued_command", "humanTurn": True,
                                 "prompt": [{"type": "text", "text": "first part"}, {"type": "image", "source": {}},
                                            {"type": "text", "text": "second part"}]}}
        session = self.load([claude_user("real request", "2026-01-01T10:00:00Z"), queued])
        self.assertEqual(session.exchanges[1].owner_text, "first part\nsecond part")

    def test_slash_command_dropped_but_prompt_after_it_kept(self):
        session = self.load([
            claude_user("<command-name>/clear</command-name>", "2026-01-01T10:00:00Z"),
            claude_user("/loop please check the deploy status every five minutes", "2026-01-01T10:01:00Z"),
            claude_user("/workspace/me/project/file.txt is wrong", "2026-01-01T10:02:00Z"),
        ])
        self.assertEqual([e.owner_text for e in session.exchanges], [
            "please check the deploy status every five minutes",
            "/workspace/me/project/file.txt is wrong",
        ])

    def test_interrupt_marker_flags_previous_exchange(self):
        session = self.load([
            claude_user("do the thing", "2026-01-01T10:00:00Z"),
            claude_user("[Request interrupted by user]", "2026-01-01T10:01:00Z"),
        ])
        self.assertEqual(len(session.exchanges), 1)
        self.assertTrue(session.exchanges[0].interrupted)

    def test_compact_summary_is_an_event_not_a_turn(self):
        session = self.load([
            claude_user("start", "2026-01-01T10:00:00Z"),
            claude_user("This session is being continued from a previous conversation that ran out", "2026-01-01T10:01:00Z"),
        ])
        self.assertEqual(len(session.exchanges), 1)
        self.assertEqual(session.exchanges[0].compactions, 1)

    def test_resumed_replay_is_removed_within_and_across_sessions(self):
        replayed = [claude_user("first ask", "2026-01-01T10:00:00Z"),
                    claude_assistant([text_block("ok")], "2026-01-01T10:00:05Z")]
        within = self.load(replayed + replayed, name="a")
        self.assertEqual(len(within.exchanges), 1)

        original = self.load(replayed, name="b")
        resumed = self.load(replayed + [claude_user("new ask", "2026-01-02T09:00:00Z")], name="c")
        drop_replayed_exchanges([original, resumed])
        self.assertEqual([e.owner_text for e in resumed.exchanges], ["new ask"])
        self.assertEqual(resumed.exchanges[0].number, 1)

    def test_activity_extraction(self):
        session = self.load([
            claude_user("make changes", "2026-01-01T10:00:00Z"),
            claude_assistant([tool_use("Edit", {"file_path": "/work/demo/a.py"}, "t1"),
                              tool_use("Write", {"file_path": "/work/demo/b.py"}, "t2"),
                              tool_use("Edit", {"file_path": "/work/demo/a.py"}, "t3")], "2026-01-01T10:00:01Z"),
            claude_assistant([tool_use("Bash", {"command": "make   test"}, "t4"),
                              tool_use("Agent", {"description": "survey the code", "prompt": "x"}, "t5")], "2026-01-01T10:00:02Z"),
            claude_assistant([text_block("All done.")], "2026-01-01T10:00:03Z"),
        ])
        exchange = session.exchanges[0]
        self.assertEqual(exchange.edited_files, ["/work/demo/a.py", "/work/demo/b.py"])
        self.assertEqual((exchange.command_count, exchange.commands), (1, ["make test"]))
        self.assertEqual(exchange.subagents, ["survey the code"])
        self.assertEqual(exchange.final_reply, "All done.")

    def test_denied_tool_call_is_recorded(self):
        session = self.load([
            claude_user("edit it", "2026-01-01T10:00:00Z"),
            claude_assistant([tool_use("Edit", {"file_path": "/work/demo/a.py"}, "t1")], "2026-01-01T10:00:01Z"),
            claude_tool_result("t1", "The user doesn't want to proceed with this tool use.", "2026-01-01T10:00:02Z",
                               is_error=True, toolDenialKind="user-rejected"),
        ])
        self.assertEqual(session.exchanges[0].denials, ["Edit /work/demo/a.py"])

    def test_subagent_transcripts_are_not_sessions(self):
        write_jsonl(self.tmp / "claude" / "-work-demo" / "s1" / "subagents" / "agent-x.jsonl",
                    [claude_user("brief", "2026-01-01T10:00:00Z")])
        self.assertEqual(self.source.discover([PROJECT]), [])


if __name__ == "__main__":
    unittest.main()
