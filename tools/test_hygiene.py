"""Run with: python3 -m unittest tools/test_hygiene.py"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import footprint  # noqa: E402
import hygiene  # noqa: E402
import pointer  # noqa: E402

MODULES = (footprint, hygiene)
REAL = {m: m.ROOT for m in MODULES}


def git(repo, *args):
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t", *args], check=True,
                   capture_output=True)


class Hygiene(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name).resolve()
        self.root = base / "master"
        for m in MODULES:
            m.ROOT = self.root
        self.repo = base / "code" / "app"
        self.repo.mkdir(parents=True)
        subprocess.run(["git", "init", "-q", "-b", "main", str(self.repo)], check=True)
        (self.repo / "README.md").write_text("# app\n")
        (self.repo / "CLAUDE.md").write_text(f"# rules\n{pointer.START}\nsee master\n{pointer.END}\n")
        (self.repo / pointer.FILE_NAME).write_text("pointer\n")
        (self.repo / "index.html").write_text("<html></html>\n")
        (self.repo / "requirements.txt").write_text("flask\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "init")
        d = self.root / "companies" / "app"
        d.mkdir(parents=True)
        (d / "company.json").write_text(json.dumps({"id": "app", "name": "App", "repos": [{"path": str(self.repo)}]}))

    def tearDown(self):
        for m, root in REAL.items():
            m.ROOT = root
        self.tmp.cleanup()

    def test_clean_repo_is_good(self):
        h = hygiene.scan("app")
        self.assertEqual((h["score"], h["reasons"]), ("good", []))
        self.assertTrue(h["pointer_ok"])
        self.assertEqual(h["claude_md_lines"], 4)
        self.assertIsNotNone(h["agent_files_last_edit"])
        self.assertTrue((self.root / "companies" / "app" / "hygiene.json").exists())

    def test_stray_files_and_untracked_make_it_fair(self):
        for name in ("PLAN.md", "notes.txt", "Screenshot 2026.png"):
            (self.repo / name).write_text("x")
        h = hygiene.scan("app")
        self.assertEqual(h["score"], "fair")
        self.assertEqual(h["stray_root_files"], 3)
        self.assertEqual(h["untracked"], 3)
        self.assertEqual(sorted(h["repos"][0]["stray"]), ["PLAN.md", "Screenshot 2026.png", "notes.txt"])

    def test_poor_when_pointer_missing_or_agent_file_huge(self):
        (self.repo / pointer.FILE_NAME).unlink()
        self.assertEqual(hygiene.scan("app")["score"], "poor")
        (self.repo / pointer.FILE_NAME).write_text("pointer\n")
        (self.repo / "AGENTS.md").write_text("line\n" * 401)
        h = hygiene.scan("app")
        self.assertEqual(h["score"], "poor")
        self.assertIn("AGENTS.md 401 lines", h["reasons"])

    def test_five_strays_is_poor(self):
        for i in range(5):
            (self.repo / f"report-{i}.md").write_text("x")
        self.assertEqual(hygiene.scan("app")["score"], "poor")

    def test_scan_never_changes_the_repo(self):
        before = subprocess.run(["git", "-C", str(self.repo), "status", "--porcelain"], capture_output=True,
                                text=True).stdout
        hygiene.scan("app")
        after = subprocess.run(["git", "-C", str(self.repo), "status", "--porcelain"], capture_output=True,
                               text=True).stdout
        self.assertEqual(before, after)

    def test_keeps_unknown_keys_and_handles_no_repos(self):
        path = self.root / "companies" / "app" / "hygiene.json"
        path.write_text(json.dumps({"note": "keep"}))
        self.assertEqual(hygiene.scan("app")["note"], "keep")
        d = self.root / "companies" / "empty"
        d.mkdir()
        (d / "company.json").write_text(json.dumps({"id": "empty", "name": "Empty", "repos": []}))
        self.assertIsNone(hygiene.scan("empty")["score"])


if __name__ == "__main__":
    unittest.main()
