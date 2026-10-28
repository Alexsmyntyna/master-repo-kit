import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from datetime import date
from pathlib import Path

import _paths  # noqa: F401
import repo_audit

TODAY = date(2026, 10, 7)


def git(root: Path, *args: str, when: str = "2026-08-01T12:00:00") -> None:
    env = {**os.environ, "GIT_COMMITTER_DATE": when, "GIT_AUTHOR_DATE": when,
           "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@t"}
    subprocess.run(["git", *args], cwd=root, env=env, check=True, capture_output=True)


def write(root: Path, relative: str, text: str = "x") -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


class RepoAuditTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(lambda: __import__("shutil").rmtree(self.root, ignore_errors=True))
        git(self.root, "init", "-q")

    def commit(self, when="2026-08-01T12:00:00"):
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "c", when=when)

    def report(self, config=None):
        full = repo_audit.load_audit_config(None, self.root)
        full.update(config or {})
        return repo_audit.build_report(self.root, full, TODAY, None)["candidates"]

    def paths(self, category, config=None, **match):
        return {c["path"] for c in self.report(config)[category]
                if all(c["signals"].get(k) == v for k, v in match.items())}

    def candidate(self, category, path):
        return next(c for c in self.report()[category] if c["path"] == path)

    def test_allowlist_excludes_allowed_root_files(self):
        for name in ("README.md", "CLAUDE.md", "LICENSE", ".gitignore", "AI_PLAN.md", "notes.txt"):
            write(self.root, name)
        self.commit()
        self.assertEqual(self.paths("loose_root_file"), {"AI_PLAN.md", "notes.txt"})

    def test_config_extends_allowlist(self):
        write(self.root, "notes.txt")
        self.commit()
        extended = {"root_allowlist": [*repo_audit.DEFAULTS["root_allowlist"], "notes.txt"]}
        self.assertEqual(self.paths("loose_root_file", extended), set())

    def test_remnant_globs_match_but_skip_source_files(self):
        for name in ("docs/plan-x.md", "docs/OLD_PLAN.md", "a.orig", "tempfile.md", "temp.md",
                     "DailyBriefTests.swift", "docs/guide.md"):
            write(self.root, name)
        self.commit()
        found = self.paths("remnant_pattern", kind="name_pattern")
        self.assertEqual(found, {"docs/plan-x.md", "docs/OLD_PLAN.md", "a.orig", "temp.md"})

    def test_duplicates_found_by_hash(self):
        body = "same content " * 20
        write(self.root, "a/one.txt", body)
        write(self.root, "b/two.txt", body)
        write(self.root, "c/three.txt", body + "different")
        self.commit()
        self.assertEqual(self.paths("remnant_pattern", kind="duplicate"), {"a/one.txt", "b/two.txt"})

    def test_empty_directories_reported(self):
        write(self.root, "keep/file.txt")
        (self.root / "hollow" / "inner").mkdir(parents=True)
        self.commit()
        self.assertEqual(self.paths("remnant_pattern", kind="empty_directory"), {"hollow/inner/"})

    def test_reference_counting_distinguishes_referenced_doc(self):
        write(self.root, "docs/used.md", "# used")
        write(self.root, "docs/lonely.md", "# lonely")
        write(self.root, "README.md", "See [used](docs/used.md).")
        self.commit()
        self.assertEqual(self.candidate("doc_health", "docs/used.md")["signals"]["inbound_references"], 1)
        self.assertEqual(self.candidate("doc_health", "docs/lonely.md")["signals"]["inbound_references"], 0)

    def test_header_parsing_and_days_since(self):
        write(self.root, "docs/a.md", "# A\n\nStatus: current authority\nLast verified: 2026-09-27\n")
        self.commit(when="2026-10-01T12:00:00")
        signals = self.candidate("doc_health", "docs/a.md")["signals"]
        self.assertEqual(signals["status"], "current authority")
        self.assertEqual(signals["last_verified"], "2026-09-27")
        self.assertEqual(signals["days_since_verified"], 10)
        self.assertEqual(signals["days_since_git_change"], 6)

    def test_checklist_ratio(self):
        write(self.root, "docs/p.md", "- [x] one\n- [X] two\n- [ ] three\n* [x] four\n")
        self.commit()
        signals = self.candidate("doc_health", "docs/p.md")["signals"]
        self.assertEqual((signals["checklist_ticked"], signals["checklist_total"]), (3, 4))

    def test_one_time_instruction_phrases(self):
        write(self.root, "docs/h.md", "Handoff notes. Do not re-litigate this. A brief overview; briefly.")
        self.commit()
        phrases = self.candidate("doc_health", "docs/h.md")["signals"]["one_time_phrases"]
        self.assertEqual(phrases, {"handoff": 1, "brief": 1, "do not re-litigate": 1})

    def test_untracked_versus_ignored_state(self):
        write(self.root, ".gitignore", "logs/\n")
        write(self.root, "tracked.md")
        self.commit()
        write(self.root, "temp.md")
        write(self.root, "logs/out.txt", "y" * 100)
        report = self.report()
        self.assertEqual(self.candidate("remnant_pattern", "temp.md")["state"], "untracked")
        logs = next(c for c in report["git_state"] if c["path"] == "logs")
        self.assertEqual(logs["state"], "ignored")
        self.assertEqual(logs["signals"]["size_bytes"], 100)
        self.assertIn("temp.md", {c["path"] for c in report["git_state"]})

    def test_protected_path_flagged(self):
        write(self.root, ".env.local", "SECRET=1")
        write(self.root, "Models/a.txt")
        self.commit()
        self.assertTrue(self.candidate("loose_root_file", ".env.local")["protected"])
        self.assertTrue(repo_audit.is_protected("Models/a.txt", ["Models/"]))
        self.assertFalse(repo_audit.is_protected("Modelsx/a.txt", ["Models/"]))

    def test_excluded_dirs_skipped(self):
        write(self.root, "node_modules/pkg/plan-x.md")
        write(self.root, "src/plan-y.md")
        self.commit()
        self.assertEqual(self.paths("remnant_pattern", kind="name_pattern"), {"src/plan-y.md"})
        self.assertNotIn("node_modules/pkg/plan-x.md", self.paths("doc_health"))

    def test_run_is_read_only(self):
        write(self.root, "AI_PLAN.md", "- [ ] a")
        write(self.root, "docs/x.md", "x")
        self.commit()
        write(self.root, "temp.md")
        (self.root / "empty").mkdir()

        def snapshot():
            return {str(p.relative_to(self.root)): p.stat().st_mtime_ns
                    for p in self.root.rglob("*") if ".git" not in p.relative_to(self.root).parts}

        before = snapshot()
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            repo_audit.main(["--project", str(self.root), "--format", "json"])
        json.loads(out.getvalue())
        self.assertEqual(snapshot(), before)


if __name__ == "__main__":
    unittest.main()
