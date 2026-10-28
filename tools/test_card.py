"""Run with: python3 -m unittest tools/test_card.py"""
import datetime as dt
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import card  # noqa: E402
import footprint  # noqa: E402
import hygiene  # noqa: E402
import refresh  # noqa: E402

MODULES = (card, footprint, hygiene, refresh)
REAL = {m: m.ROOT for m in MODULES}
OLD = (dt.date.today() - dt.timedelta(days=30)).isoformat()
NEW = dt.date.today().isoformat()


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


class Card(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name).resolve()
        self.root = base / "master"
        for m in MODULES:
            m.ROOT = self.root
        self.repo = base / "code" / "shop"
        self.repo.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        write(self.repo / "package.json", json.dumps({"dependencies": {"mongoose": "8"}}))
        co = self.root / "companies" / "shop"
        write(co / "company.json", json.dumps({"id": "shop", "name": "Shop", "repos": [{"path": str(self.repo)}]}))
        write(self.root / "holding" / "portfolio.json", json.dumps({"focus": ["shop"]}))
        write(self.root / "holding" / "pulse.json", json.dumps({"projects": [
            {"slug": "shop", "last_commit": OLD, "idle_days": 1, "commits_30d": 4, "uncommitted": 2, "branches": 1}]}))
        write(co / "threads" / "a" / "thread.md", '---\nstatus: "awaiting-owner"\ndecision: "Ship it"\n---\n\nx\n')
        write(co / "threads" / "a" / "001-coo.md", f'---\nfrom: "coo"\nkind: "decision"\ndate: "{OLD}"\n---\n\nx\n')
        write(co / "threads" / "b" / "thread.md", '---\nstatus: "awaiting-owner"\n---\n\nx\n')
        write(co / "threads" / "b" / "001-coo.md", f'---\nfrom: "coo"\nkind: "report"\ndate: "{NEW}"\n---\n\nx\n')
        write(co / "threads" / "c" / "thread.md", '---\nstatus: "decided"\n---\n\nx\n')
        write(co / "builds" / "b1" / "build.md", f'---\ntitle: "One"\nstatus: "review"\nupdated: "{OLD}T10:00:00"\n---\n\nbody\n')
        write(co / "builds" / "b2" / "build.md", f'---\nstatus: "approved"\nupdated: "{NEW}T10:00:00"\n---\n\nbody\n')
        self.co = co

    def tearDown(self):
        for m, root in REAL.items():
            m.ROOT = root
        self.tmp.cleanup()

    def test_new_card_has_empty_human_keys_and_a_needs_marker(self):
        footprint.scan("shop")
        c = card.refresh("shop")
        self.assertEqual((c["goal"], c["gates"], c["blocker"], c["next"]), (None, [], None, None))
        self.assertEqual(c["needs"], "goal, gates, blocker, next")
        self.assertEqual(c["owes"], {"decisions": 1, "builds_review": 1, "builds_approved_unrun": 1,
                                     "threads_awaiting": 1})
        self.assertEqual(c["moved"]["commits_30d"], 4)
        self.assertEqual(c["moved"]["idle_days"], 30)  # recomputed from last_commit, not copied
        self.assertEqual(c["tier"], "focus")
        self.assertEqual(c["footprint"]["database"], ["mongodb"])
        self.assertIsNone(c["hygiene"])

    def test_refresh_preserves_human_and_unknown_keys(self):
        human = {"slug": "shop", "kind": "sell", "kind_source": "owner",
                 "goal": {"text": "First sale", "source": "owner", "ref": "x", "date": "2026-10-12"},
                 "gates": [{"name": "live site", "state": "done"}, {"name": "payments", "state": "open"}],
                 "blocker": {"text": "No keys"}, "next": {"text": "Check keys"}, "updated": "2026-10-24",
                 "extra": [1, 2], "moved": {"stale": True}}
        write(self.co / "card.json", json.dumps(human))
        c = card.refresh("shop")
        for k in ("kind", "goal", "gates", "blocker", "next", "updated", "extra"):
            self.assertEqual(c[k], human[k])
        self.assertNotIn("needs", c)
        self.assertNotIn("stale", c["moved"])  # derived keys are overwritten
        lines = card.show_lines(c, "Shop")
        self.assertLessEqual(len(lines), 12)
        self.assertEqual(lines[0], "Shop · sell · focus")
        self.assertIn("✓ live site", lines[2])
        self.assertIn("○ payments", lines[2])

    def test_show_and_board_cli(self):
        card.refresh("shop")
        write(self.root / "companies" / "quiet" / "company.json", json.dumps({"id": "quiet", "name": "Q", "repos": []}))
        card.refresh("quiet")
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(card.main(["show", "shop"]), 0)
        self.assertIn("Owes: 1 decision", out.getvalue())
        out = io.StringIO()
        with redirect_stdout(out):
            card.main(["board"])
        rows = [ln for ln in out.getvalue().splitlines() if not ln.startswith(" ")]
        self.assertTrue(rows[0].startswith("shop"))  # owes the owner, so first

    def test_board_order_puts_idle_footprint_before_quiet_projects(self):
        cards = [
            {"slug": "fresh", "moved": {"idle_days": 2}, "owes": {}, "footprint": {"hosting": []}},
            {"slug": "costly", "moved": {"idle_days": 40}, "owes": {}, "footprint": {"hosting": ["digitalocean"]}},
            {"slug": "old", "moved": {"idle_days": 90}, "owes": {}, "footprint": {"hosting": []}},
            {"slug": "owing", "moved": {"idle_days": 1}, "owes": {"decisions": 1}, "footprint": None},
        ]
        self.assertEqual([c["slug"] for c in card.board_order(cards)], ["costly", "owing", "old", "fresh"])

    def test_mark_stale_rewrites_only_status(self):
        thread = self.co / "threads" / "a" / "thread.md"
        before = thread.read_text()
        marked = refresh.mark_stale(self.root)
        self.assertEqual(sorted(marked), ["companies/shop/builds/b1/build.md", "companies/shop/threads/a/thread.md"])
        after = thread.read_text()
        self.assertIn('status: "stale"', after)
        self.assertIn(f'stale_since: "{NEW}"', after)
        self.assertEqual(after.replace('status: "stale"\nstale_since: "' + NEW + '"', 'status: "awaiting-owner"'), before)
        self.assertIn('status: "awaiting-owner"', (self.co / "threads" / "b" / "thread.md").read_text())  # recent
        self.assertIn('status: "approved"', (self.co / "builds" / "b2" / "build.md").read_text())
        self.assertIn("body", (self.co / "builds" / "b1" / "build.md").read_text())
        self.assertEqual(card.refresh("shop")["owes"]["decisions"], 0)


class RefreshCommit(unittest.TestCase):
    def test_secret_like_and_private_files_are_not_committed(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve()
            env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                   "GIT_COMMITTER_EMAIL": "t@t", "PATH": os.environ["PATH"], "HOME": d}
            run = lambda *a: subprocess.run(["git", "-C", str(root), *a], check=True, capture_output=True, env=env)
            run("init", "-q", "-b", "main")
            write(root / "companies" / "x" / "ok.md", "fine\n")
            write(root / "companies" / "x" / "bad.md", "uri mongodb+srv://u:p@host/db\n")
            write(root / "companies" / "x" / "password-notes.md", "harmless\n")
            real, real_git = refresh.ROOT, refresh.git
            refresh.ROOT = root
            refresh.git = lambda *a, check=False: subprocess.run(["git", "-C", str(root), *a], capture_output=True,
                                                                  text=True, check=check, env=env)
            try:
                out = io.StringIO()
                with redirect_stdout(out):
                    refresh.commit(dt.date.today())
            finally:
                refresh.ROOT, refresh.git = real, real_git
            self.assertIn("skipped (secret-like): companies/x/bad.md", out.getvalue())
            tracked = run("ls-files").stdout.decode().split()
            self.assertEqual(tracked, ["companies/x/ok.md"])


if __name__ == "__main__":
    unittest.main()
