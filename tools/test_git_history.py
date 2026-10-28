"""Run with: python3 -m unittest tools/test_git_history.py"""
import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import git_history as gh  # noqa: E402


def git(repo, *args, date=None):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    if date:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = f"{date}T12:00:00"
    subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, env=env)


class LedgerFlow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.repo = base / "proj"
        self.repo.mkdir()
        git(self.repo, "init", "-q")
        # Two bursts separated by a long gap, plus build noise.
        for i, (date, msg) in enumerate([("2026-01-01", "Add camera"), ("2026-01-02", "Fix camera crash"),
                                          ("2026-03-01", "Add sharing"), ("2026-03-02", "Fix sharing bug")]):
            (self.repo / "app.swift").write_text(f"v{i}\n")
            (self.repo / "build").mkdir(exist_ok=True)
            (self.repo / "build" / "out.o").write_text(f"{i}\n" * 1000)
            git(self.repo, "add", "-A")
            git(self.repo, "commit", "-q", "-m", msg, date=date)
        company = base / "companies" / "proj"
        company.mkdir(parents=True)
        (company / "company.json").write_text(json.dumps({"repos": [{"path": str(self.repo), "subdir": None}]}))
        self.old_root, gh.ROOT = gh.ROOT, base

    def tearDown(self):
        gh.ROOT = self.old_root
        self.tmp.cleanup()

    def run_cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            gh.main(list(argv))
        return buf.getvalue()

    def test_segments_split_on_gap_and_filter_noise(self):
        commits = gh.load_commits(gh.project_repos("proj")[0])
        self.assertEqual(len(commits), 4)
        self.assertTrue(all(p == "app.swift" for c in commits for p, _, _ in c.files))
        self.assertEqual([len(s) for s in gh.segment(commits)], [2, 2])
        self.assertTrue(commits[1].is_fix and not commits[1].is_feature)
        self.assertTrue(commits[0].is_feature)

    def test_mark_then_unread_excludes_read_segment(self):
        repo = gh.project_repos("proj")[0]
        first = gh.seg_id(gh.segment(gh.load_commits(repo))[0])
        self.run_cli("mark", "proj", "--segment", first, "--ref", "companies/proj/notes/x.md")
        ledger = gh.load_ledger("proj")
        self.assertEqual(len(gh.read_shas(ledger, repo)), 2)
        report = self.run_cli("report", "proj", "--unread")
        self.assertNotIn(f"Segment `{first}`", report)
        self.assertIn("Add sharing", report)
        # Marking again adds nothing new.
        self.assertIn("nothing new", self.run_cli("mark", "proj", "--segment", first, "--ref", "x"))
        self.run_cli("mark", "proj", "--all-unread", "--ref", "y")
        self.assertIn("  4     0", self.run_cli("status", "proj"))


if __name__ == "__main__":
    unittest.main()
