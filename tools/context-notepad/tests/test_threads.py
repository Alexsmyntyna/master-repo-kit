import contextlib
import io
import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401
import notepad


def run(root: Path, *argv) -> str:
    out = io.StringIO()
    config = root / "config.json"
    if not config.exists():
        config.write_text("{}")
    with contextlib.redirect_stdout(out):
        notepad.main([argv[0], "--project", str(root), "--config", str(config), *argv[1:]])
    return out.getvalue()


class ThreadTestCase(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(lambda: shutil.rmtree(self.root, ignore_errors=True))
        (self.root / ".git").mkdir()
        self.threads = self.root / "context-notepad" / "threads"

    def notepad_text(self, thread="demo"):
        return (self.threads / thread / "notepad.md").read_text()

    def sections(self, thread="demo"):
        return notepad.parse_document(self.notepad_text(thread))[1]


class FolderLayoutTests(ThreadTestCase):
    def test_new_thread_creates_folders_notepad_and_index_line(self):
        run(self.root, "new", "demo", "--title", "Demo Feature", "--scope", "inbox,triage", "--apply")
        for name in ("notepad.md", "briefs", "mockups"):
            self.assertTrue((self.threads / "demo" / name).exists(), name)
        index = (self.threads / "INDEX.md").read_text()
        self.assertIn("- demo | Demo Feature | active | inbox,triage", index)

    def test_dry_run_creates_nothing(self):
        run(self.root, "new", "demo")
        self.assertFalse(self.threads.exists())

    def test_meta_change_updates_index(self):
        run(self.root, "new", "demo", "--scope", "a", "--apply")
        run(self.root, "meta", "demo", "--status", "paused", "--scope", "x,y", "--apply")
        self.assertIn("- demo | demo | paused | x,y", (self.threads / "INDEX.md").read_text())

    def test_mockup_dir_defaults_to_thread_and_honors_config(self):
        config = notepad.Config()
        root = notepad.notepad_root(self.root, config.notepad_dir)
        self.assertEqual(notepad.mockup_dir(self.root, root, config, "Demo"), self.threads / "demo" / "mockups")
        config.mockup_dir = "prototypes/{thread}"
        self.assertEqual(notepad.mockup_dir(self.root, root, config, "Demo"), self.root / "prototypes" / "demo")


class MigrateTests(ThreadTestCase):
    def test_migrate_moves_single_file_thread_into_folder_layout(self):
        self.threads.mkdir(parents=True)
        old = notepad.skeleton("Old", "old", "2026-01-01")
        old = notepad.append_to_section(old, "Next", "- 2026-01-02: finish the thing")
        old = old.replace("Status: active\nScope:\n", "")
        (self.threads / "old.md").write_text(old)
        (self.threads / ".history").mkdir()
        (self.threads / ".history" / "old.20260101-000000.md").write_text("backup")

        run(self.root, "migrate")
        self.assertTrue((self.threads / "old.md").exists())
        run(self.root, "migrate", "--apply")

        self.assertFalse((self.threads / "old.md").exists())
        self.assertTrue((self.threads / "old" / ".history" / "notepad.20260101-000000.md").is_file())
        next_body = self.sections("old")["Next"]
        self.assertIn("- [ ] N1 2026-01-02: finish the thing", next_body)
        self.assertIn("Status: active", self.notepad_text("old"))
        self.assertIn("- old | Old | active |", (self.threads / "INDEX.md").read_text())


class ChecklistTests(ThreadTestCase):
    def setUp(self):
        super().setUp()
        run(self.root, "new", "demo", "--apply")

    def test_next_assigns_increasing_ids_that_are_never_reused(self):
        run(self.root, "next", "demo", "first", "--apply")
        run(self.root, "next", "demo", "second", "--apply")
        run(self.root, "check", "demo", "N2", "--evidence", "abc", "--apply")
        run(self.root, "next", "demo", "third", "--apply")
        self.assertIn("- [ ] N3 third", self.sections()["Next"])

    def test_check_requires_evidence_and_moves_item_to_done(self):
        run(self.root, "next", "demo", "wire up", "--apply")
        with self.assertRaises(SystemExit):
            run(self.root, "check", "demo", "N1", "--evidence", "  ", "--apply")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            run(self.root, "check", "demo", "N1", "--apply")  # argparse: missing --evidence
        run(self.root, "check", "demo", "N1", "--evidence", "a1b2c3d, InboxTests", "--apply")
        sections = self.sections()
        self.assertEqual(sections["Done"], "- [x] N1 wire up (a1b2c3d, InboxTests)")
        self.assertNotIn("N1", sections["Next"])

    def test_drop_keeps_item_with_reason_and_needs_a_reason(self):
        run(self.root, "next", "demo", "polish", "--apply")
        with self.assertRaises(SystemExit):
            run(self.root, "drop", "demo", "N1", "--reason", " ", "--apply")
        run(self.root, "drop", "demo", "N1", "--reason", "owner said skip", "--apply")
        self.assertEqual(self.sections()["Next"], "- [~] N1 polish: dropped, owner said skip")

    def test_edits_to_existing_lines_back_up_the_notepad(self):
        run(self.root, "next", "demo", "one", "--apply")
        run(self.root, "drop", "demo", "N1", "--reason", "r", "--apply")
        self.assertEqual(len(list((self.threads / "demo" / ".history").glob("notepad.*.md"))), 1)

    def test_audit_lists_open_and_blocked_across_threads_but_not_finished_or_dropped(self):
        run(self.root, "new", "other", "--apply")
        for text in ("a", "b", "c"):
            run(self.root, "next", "demo", text, "--apply")
        run(self.root, "next", "other", "z", "--apply")
        run(self.root, "check", "demo", "N1", "--evidence", "e", "--apply")
        run(self.root, "block", "demo", "N2", "--reason", "needs key", "--apply")
        output = run(self.root, "audit")
        self.assertIn("blocked", output)
        self.assertIn("N3", output)
        self.assertIn("other", output)
        self.assertNotIn(" a\n", output)
        self.assertIn("3 item(s) across 2 thread(s)", output)


class BriefTests(ThreadTestCase):
    def test_brief_copies_selected_vision_quotes_verbatim_and_prints_path(self):
        run(self.root, "new", "demo", "--apply")
        path = self.threads / "demo" / "notepad.md"
        first = "keep   spacing\n\n- and a dash line\n> nested quote"
        second = "second thought"
        document = path.read_text()
        for text in (first, second):
            document = notepad.append_to_section(document, "Vision", notepad.quote_bullet(text, "2026-10-01", "claude:abc turn 1"))
        path.write_text(document)
        run(self.root, "next", "demo", "build it", "--apply")

        output = run(self.root, "brief", "demo", "--goal", "Build the inbox view", "--items", "N1", "--owns", "Read/Inbox",
                     "--out-of-scope", "Settings", "--verify", "InboxTests", "--quotes", "1", "--apply")
        brief = Path(output.strip().splitlines()[-1])
        self.assertEqual(brief.parent, self.threads / "demo" / "briefs")
        text = brief.read_text()
        quoted = "\n".join(f"> {line}".rstrip() for line in first.splitlines())
        self.assertIn(quoted, text)
        self.assertNotIn("second thought", text)
        self.assertIn("- [ ] N1 build it", text)

    def test_brief_rejects_unknown_quote_or_item(self):
        run(self.root, "new", "demo", "--apply")
        base = ["brief", "demo", "--goal", "g", "--owns", "o", "--out-of-scope", "s", "--verify", "v"]
        with self.assertRaises(SystemExit):
            run(self.root, *base, "--quotes", "3")
        with self.assertRaises(SystemExit):
            run(self.root, *base, "--items", "N9")


class RouteTests(ThreadTestCase):
    def test_route_ranks_thread_with_most_scope_words_first(self):
        run(self.root, "new", "inbox", "--title", "Inbox triage", "--scope", "inbox,triage,email", "--apply")
        run(self.root, "new", "health", "--title", "Health logging", "--scope", "weight,food,nutrition", "--apply")
        output = run(self.root, "route", "fix the inbox triage ordering")
        lines = output.strip().splitlines()
        self.assertTrue(lines[0].split()[1] == "inbox")
        self.assertNotIn("health", output)

    def test_route_with_no_match_says_so(self):
        run(self.root, "new", "inbox", "--scope", "inbox", "--apply")
        self.assertIn("No thread matches", run(self.root, "route", "rename a variable"))


if __name__ == "__main__":
    unittest.main()
