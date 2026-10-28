import contextlib
import io
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


class NotepadTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root, ignore_errors=True))
        (self.root / ".git").mkdir()
        self.file = self.root / "context-notepad" / "threads" / "demo" / "notepad.md"

    def test_dry_run_writes_nothing_and_apply_creates_all_sections(self):
        run(self.root, "new", "demo", "--title", "Demo")
        self.assertFalse(self.file.exists())
        run(self.root, "new", "demo", "--title", "Demo", "--apply")
        headings = [l for l in self.file.read_text().splitlines() if l.startswith("## ")]
        self.assertEqual(headings, [f"## {s}" for s in notepad.SECTIONS])

    def test_append_keeps_earlier_entries(self):
        run(self.root, "new", "demo", "--apply")
        run(self.root, "add", "demo", "done", "first", "--apply")
        run(self.root, "add", "demo", "Done", "second", "--apply")
        _, sections = notepad.parse_document(self.file.read_text())
        bullets = sections["Done"].splitlines()
        self.assertEqual(len(bullets), 2)
        self.assertTrue(bullets[0].endswith("first") and bullets[1].endswith("second"))

    def test_append_only_sections_refuse_replace_and_vision_refuses_add(self):
        run(self.root, "new", "demo", "--apply")
        with self.assertRaises(SystemExit):
            run(self.root, "add", "demo", "Drift", "x", "--replace", "--apply")
        with self.assertRaises(SystemExit):
            run(self.root, "add", "demo", "Vision", "paraphrase", "--apply")

    def test_replace_backs_up_previous_file_first(self):
        run(self.root, "new", "demo", "--apply")
        run(self.root, "add", "demo", "Interpretation", "old plan", "--apply")
        before = self.file.read_text()
        run(self.root, "add", "demo", "Interpretation", "new plan", "--replace", "--apply")
        backups = list((self.file.parent / ".history").glob("notepad.*.md"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), before)
        _, sections = notepad.parse_document(self.file.read_text())
        self.assertIn("new plan", sections["Interpretation"])
        self.assertNotIn("old plan", sections["Interpretation"])

    def test_quote_text_is_verbatim_in_vision(self):
        text = "keep   spacing\n\nand a second paragraph"
        entry = notepad.quote_bullet(text, "2026-01-01", "claude:abc turn 1")
        document = notepad.append_to_section(notepad.skeleton("T", "t", "2026-01-01"), "Vision", entry)
        _, sections = notepad.parse_document(document)
        unquoted = [l.split("> ", 1)[1] if "> " in l else "" for l in sections["Vision"].splitlines()[1:]]
        self.assertEqual("\n".join(unquoted), text)


if __name__ == "__main__":
    unittest.main()
