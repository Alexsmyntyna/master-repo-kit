import argparse
import contextlib
import io
import json
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

import _paths  # noqa: F401
import activity_log
from fixtures import PROJECT, claude_assistant, claude_user, make_config, text_block, tool_use, write_jsonl


def hours_ago(hours: float) -> str:
    return (datetime.now().astimezone() - timedelta(hours=hours)).isoformat(timespec="seconds")


class ActivityLogCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        (self.tmp / ".git").mkdir()
        self.log = self.tmp / "context-notepad" / "activity.jsonl"

    def add(self, **fields):
        base = {"agent": "claude", "event": "small_task", "title": "t"}
        return activity_log.append_entry(self.log, {**base, **fields})


class AppendTests(ActivityLogCase):
    def test_ids_increase_monotonically_across_appends(self):
        ids = [self.add()["id"] for _ in range(3)]
        self.assertEqual(ids, ["e1", "e2", "e3"])
        self.assertEqual([e["id"] for e in activity_log.read_entries(self.log)], ids)

    def test_more_than_four_bullets_is_rejected_and_nothing_is_written(self):
        with self.assertRaises(ValueError):
            self.add(bullets=["1", "2", "3", "4", "5"])
        self.assertFalse(self.log.exists())
        self.add(bullets=["1", "2", "3", "4"])

    def test_review_fields_only_on_review_events(self):
        with self.assertRaises(ValueError):
            self.add(event="small_task", verdict="accepted")
        self.add(event="review", verdict="escalated", escalated_to="opus", reason="missed tests")

    def test_cli_add_is_a_dry_run_until_apply(self):
        config = self.tmp / "config.json"
        config.write_text("{}")
        argv = ["add", "--project", str(self.tmp), "--config", str(config), "--event", "small_task", "--title", "x"]
        with contextlib.redirect_stdout(io.StringIO()):
            activity_log.main(argv)
            self.assertFalse(self.log.exists())
            activity_log.main([*argv, "--apply"])
        self.assertEqual(len(activity_log.read_entries(self.log)), 1)


class QueryTests(ActivityLogCase):
    def test_window_excludes_older_entries_and_filters_by_thread(self):
        self.add(at=hours_ago(30), title="old")
        self.add(at=hours_ago(2), title="recent", thread="a")
        self.add(at=hours_ago(1), title="other", thread="b")
        entries = activity_log.read_entries(self.log)
        titles = [e["title"] for e in activity_log.select_window(entries, 24, None, None)]
        self.assertEqual(titles, ["recent", "other"])
        self.assertEqual([e["title"] for e in activity_log.select_window(entries, 24, "a", None)], ["recent"])

    def test_markdown_renders_children_nested_under_parent_with_bullets(self):
        root = self.add(event="session_start", title="Feature work")
        child = self.add(event="subagent_launch", title="Build view", parent=root["id"], bullets=["goal one"])
        self.add(event="review", title="Review view", parent=child["id"], verdict="accepted")
        text = activity_log.render_tree(activity_log.read_entries(self.log))
        lines = text.splitlines()
        self.assertTrue(lines[0].startswith("- e1 session_start"))
        self.assertTrue(lines[1].startswith("  - e2 subagent_launch"))
        self.assertEqual(lines[2], "    - goal one")
        self.assertTrue(lines[3].startswith("    - e3 review") and lines[3].endswith("-> accepted"))

    def test_entry_whose_parent_is_outside_the_window_becomes_a_root(self):
        self.add(at=hours_ago(40), event="session_start", title="old session")
        self.add(at=hours_ago(1), event="subagent_launch", title="late", parent="e1")
        entries = activity_log.select_window(activity_log.read_entries(self.log), 24, None, None)
        self.assertTrue(activity_log.render_tree(entries).startswith("- e2 subagent_launch"))


class BackfillTests(ActivityLogCase):
    def setUp(self):
        super().setUp()
        self.config = make_config(self.tmp)
        self.config.repo_prefixes = [PROJECT]
        self.config.activity_log = "context-notepad/activity.jsonl"
        brief = "Implement the view\nmore detail"
        write_jsonl(self.tmp / "claude" / "proj" / "sess1.jsonl", [
            claude_user("please build it", "2026-10-05T10:00:00Z"),
            claude_assistant([tool_use("Agent", {"description": "Build view", "subagent_type": "general-purpose",
                                                 "model": "sonnet", "prompt": brief}, "tu1"), text_block("ok")],
                             "2026-10-05T10:01:00Z"),
        ])

    def backfill(self, apply):
        args = argparse.Namespace(project=self.tmp, since="2026-10-01", apply=apply)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            activity_log.command_backfill(args, self.config)
        return out.getvalue()

    def test_dry_run_lists_and_apply_appends_session_and_launch_with_parent(self):
        self.assertIn("would add", self.backfill(apply=False))
        self.assertFalse(self.log.exists())
        self.backfill(apply=True)
        entries = activity_log.read_entries(self.log)
        self.assertEqual([e["event"] for e in entries], ["session_start", "subagent_launch"])
        self.assertEqual(entries[1]["parent"], entries[0]["id"])
        self.assertEqual(entries[1]["model"], "sonnet")
        self.assertEqual(entries[1]["bullets"], ["Implement the view"])

    def test_second_backfill_skips_entries_already_logged_by_key(self):
        self.backfill(apply=True)
        self.assertIn("Nothing to backfill", self.backfill(apply=True))
        self.assertEqual(len(activity_log.read_entries(self.log)), 2)


class ModelsTests(ActivityLogCase):
    def test_counts_launches_and_verdicts_per_model(self):
        self.add(event="subagent_launch", model="haiku")
        self.add(event="subagent_launch", model="haiku")
        self.add(event="review", model="haiku", verdict="escalated", escalated_to="sonnet")
        self.add(event="review", model="sonnet", verdict="accepted")
        self.add(event="review", model="sonnet", verdict="fixed_by_reviewer")
        config = self.tmp / "config.json"
        config.write_text("{}")
        args = argparse.Namespace(project=self.tmp, days=30)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            activity_log.command_models(args, activity_log.load_config(config))
        text = out.getvalue()
        self.assertIn("EXPERIMENTAL", text)
        rows = {line.split()[0]: line.split()[1:] for line in text.splitlines() if line.startswith(("haiku", "sonnet"))}
        self.assertEqual(rows["haiku"], ["2", "0", "0", "1"])
        self.assertEqual(rows["sonnet"], ["0", "1", "1", "0"])


if __name__ == "__main__":
    unittest.main()
