"""Run with: python3 -m unittest tools/test_inbox.py"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import inbox  # noqa: E402

REAL_ROOT = inbox.ROOT
REAL_NOW = inbox.now


class Inbox(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name).resolve()
        inbox.ROOT = self.root = base / "master"
        inbox.now = lambda: datetime(2026, 10, 24, 9, 5)
        self.company = self.root / "companies" / "demo"
        (self.company / "wiki" / "fronts").mkdir(parents=True)
        (self.company / "company.json").write_text(json.dumps({"id": "demo", "name": "Demo", "repos": []}))
        (self.root / "companies" / "other").mkdir()
        (self.root / "companies" / "other" / "company.json").write_text(json.dumps({"id": "other", "name": "Other App"}))
        self.outside = base / "project"
        self.outside.mkdir()
        self.cwd = os.getcwd()
        os.chdir(self.outside)

    def tearDown(self):
        os.chdir(self.cwd)
        inbox.ROOT = REAL_ROOT
        inbox.now = REAL_NOW
        self.tmp.cleanup()

    def run_cli(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = inbox.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def test_note_writes_dated_file_with_frontmatter_and_suffixes_repeats(self):
        (self.outside / ".git").mkdir()
        code, out, _ = self.run_cli("note", "demo", "Login works by hand.", "--title", "Hand test: login", "--ref", "src/a.ts")
        self.assertEqual(code, 0)
        path = self.company / "notes" / "2026-10-24-hand-test-login.md"
        text = path.read_text()
        self.assertIn('title: "Hand test: login"', text)
        self.assertIn("kind: note", text)
        self.assertIn("written_by: agent", text)
        self.assertIn('from: "project"', text)
        self.assertIn('ref: "src/a.ts"', text)
        self.assertTrue(text.endswith("Login works by hand.\n"))
        self.run_cli("note", "demo", "Again.", "--title", "Hand test: login")
        self.assertTrue((self.company / "notes" / "2026-10-24-hand-test-login-2.md").exists())

    def test_report_goes_to_reports_and_decision_needed_to_notes(self):
        self.run_cli("note", "demo", "Findings.", "--title", "Audit", "--kind", "report")
        self.assertIn('from: "project-agent"', (self.company / "reports" / "2026-10-24-audit.md").read_text())
        self.run_cli("note", "demo", "Pick one.", "--title", "Stripe or Paddle", "--kind", "decision-needed")
        self.assertIn("kind: decision-needed", (self.company / "notes" / "2026-10-24-stripe-or-paddle.md").read_text())

    def test_unknown_slug_is_refused(self):
        with self.assertRaises(SystemExit):
            self.run_cli("note", "nope", "x")

    def test_mockup_copies_files_writes_review_and_refuses_big_files(self):
        (self.outside / "index.html").write_text("<p>hi</p>")
        (self.outside / "home.png").write_bytes(b"png")
        big = self.outside / "big.png"
        with open(big, "wb") as f:
            f.truncate(inbox.MAX_BYTES + 1)
        code, out, err = self.run_cli("mockup", "demo", "home.png", "index.html", "big.png",
                                      "--title", "Phone home", "--question", "Is the tab bar right?")
        self.assertEqual(code, 0)
        self.assertIn("big.png", err)
        self.assertIn("5 MB", err)
        folder = self.company / "mockups" / "2026-10-24-phone-home"
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ["home.png", "index.html", "review.md"])
        review = (folder / "review.md").read_text()
        self.assertIn("status: open", review)
        self.assertIn('  - { file: "index.html", label: "index" }', review)
        self.assertLess(review.index("index.html"), review.index("home.png"))
        self.assertIn('  - ask: "Is the tab bar right?"', review)
        self.assertIn("| Choice in the mockup | Gains | Costs |", review)

    def test_mockup_rejects_extension_private_name_and_symlink_but_copies_png(self):
        (self.outside / "notes.txt").write_text("x")
        (self.outside / "token-screen.png").write_bytes(b"png")
        (self.outside / "real.png").write_bytes(b"png")
        os.symlink(self.outside / "real.png", self.outside / "link.png")
        (self.outside / "good.png").write_bytes(b"png")
        code, _, err = self.run_cli("mockup", "demo", "notes.txt", "token-screen.png", "link.png", "good.png",
                                    "--title", "Mixed")
        self.assertEqual(code, 0)
        self.assertIn("notes.txt: extension not allowed", err)
        self.assertIn("token-screen.png: private-looking", err)
        self.assertIn("link.png: links are refused", err)
        folder = self.company / "mockups" / "2026-10-24-mixed"
        self.assertEqual(sorted(p.name for p in folder.iterdir()), ["good.png", "review.md"])

    def test_mockup_with_nothing_copied_exits_nonzero(self):
        (self.outside / "a.txt").write_text("x")
        code, _, err = self.run_cli("mockup", "demo", "a.txt")
        self.assertEqual(code, 1)
        self.assertIn("nothing to copy", err)

    def test_mockup_with_only_refused_files_fails(self):
        code, _, err = self.run_cli("mockup", "demo", "missing.png")
        self.assertEqual(code, 1)
        self.assertIn("not found", err)

    def test_rule_scopes_and_legacy(self):
        self.run_cli("rule", "design", "Owner taste")
        self.run_cli("rule", "design", "Generic rule", "--scope", "generic")
        self.run_cli("rule", "design", "Project rule", "--scope", "project", "--project", "demo")
        self.run_cli("rule", "stack:demo", "Legacy rule")
        self.assertIn("Owner taste.", (self.root / "local/standards/design.md").read_text())
        self.assertIn("Generic rule.", (self.root / "standards/design.md").read_text())
        text = (self.company / "standards.md").read_text()
        self.assertIn("## design", text)
        self.assertIn("## stack", text)
        self.assertIn("Legacy rule.", text)
        self.assertNotIn("Project rule", (self.root / "standards/design.md").read_text())

    def test_rule_requires_project_and_refuses_conflicts(self):
        for args in [("--scope", "project"), ("--scope", "owner", "--project", "demo")]:
            with self.assertRaises(SystemExit):
                self.run_cli("rule", "design", "Rule", *args)
        with self.assertRaises(SystemExit):
            self.run_cli("rule", "design:demo", "Rule", "--scope", "generic")

    def test_rule_rejects_unknown_scope(self):
        with self.assertRaises(SystemExit):
            self.run_cli("rule", "colours", "x")

    def test_done_appends_session_lines(self):
        self.run_cli("done", "demo", "Fixed login; gate 'hand-tested happy path' now done.")
        inbox.now = lambda: datetime(2026, 10, 24, 17, 30)
        self.run_cli("done", "demo", "Second session.")
        text = (self.company / "notes" / "2026-10-24-sessions.md").read_text()
        self.assertTrue(text.startswith("---\n"))
        self.assertTrue(text.endswith("---\n\n- 09:05 Fixed login; gate 'hand-tested happy path' now done.\n- 17:30 Second session.\n"))

    def test_context_shows_card_fronts_recent_and_standards(self):
        (self.company / "card.json").write_text(json.dumps({
            "kind": "sell", "goal": {"text": "First sale."}, "blocker": {"text": "No Stripe."}, "next": {"text": "Make an account."},
            "gates": [{"name": "domain", "state": "done"}, {"name": "payments", "state": "open", "note": "Stripe"}]}))
        (self.company / "wiki" / "fronts" / "a.md").write_text("---\ntitle: Speed\nstatus: open\nsummary: \"Slow lists.\"\n---\n")
        (self.company / "wiki" / "fronts" / "b.md").write_text("---\ntitle: Old\nstatus: settled\n---\n")
        for i in range(7):
            self.run_cli("note", "demo", f"n{i}", "--title", f"Note {i}")
        (self.company / "builds" / "2026-10-25-later").mkdir(parents=True)
        (self.company / "builds" / "2026-10-25-later" / "build.md").write_text("---\ntitle: \"Later build\"\n---\n")
        self.run_cli("rule", "stack", "Python stdlib for tools")
        code, out, _ = self.run_cli("context", "demo")
        self.assertEqual(code, 0)
        self.assertIn("Goal: First sale.", out)
        self.assertIn("Blocker: No Stripe.", out)
        self.assertIn("- payments (open): Stripe", out)
        self.assertNotIn("domain", out)
        self.assertIn("Speed (open): Slow lists.", out)
        self.assertNotIn("Old", out)
        self.assertIn("2026-10-25 build: Later build", out)
        self.assertEqual(out.count("2026-10-24 note:"), 4)
        self.assertIn("`local/standards/stack.md`", out)
        self.assertLess(len(out.splitlines()), 60)

    def test_context_without_card(self):
        code, out, _ = self.run_cli("context", "demo")
        self.assertIn("No card yet", out)
        self.assertIn("None open.", out)


if __name__ == "__main__":
    unittest.main()


def test_context_recent_decisions(tmp_path, monkeypatch):
    monkeypatch.setattr(inbox, 'ROOT', tmp_path)
    base = tmp_path / 'companies/demo'
    base.mkdir(parents=True)
    (base / 'company.json').write_text('{"name": "Demo"}')
    decisions = [{'date': f'2026-10-{i:02d}', 'decision': f'Choice {i}\nsecond line'} for i in range(1, 11)]
    (base / 'decisions.json').write_text(json.dumps(decisions))
    output = inbox.cmd_context('demo')
    assert '2026-10-10: Choice 10 second line' in output
    assert output.index('Choice 10') < output.index('Choice 9')
    assert 'Choice 2 second line' not in output
    assert 'Choice 3 second line' in output
    assert output.index('## Recent decisions') < output.index('## Open fronts')
