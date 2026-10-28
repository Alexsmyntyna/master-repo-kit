"""notepad_dir, activity_log and mockup_dir accept absolute and ~ paths (data kept outside the project)."""
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import _paths  # noqa: F401
import activity_log
import notepad
from transcript_sources import Config, resolve_project_path


class ExternalPathTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.project = self.tmp / "project"
        (self.project / ".git").mkdir(parents=True)
        self.store = self.tmp / "store"

    def test_relative_stays_in_project_absolute_stands_alone(self):
        self.assertEqual(resolve_project_path(self.project, "a/b"), self.project / "a" / "b")
        self.assertEqual(resolve_project_path(self.project, str(self.store)), self.store)

    def test_tilde_expands_to_home(self):
        with mock.patch.dict(os.environ, {"HOME": str(self.tmp)}):
            self.assertEqual(resolve_project_path(self.project, "~/notes"), self.tmp / "notes")

    def test_notepad_and_activity_log_land_outside_the_project(self):
        config = Config(notepad_dir=str(self.store / "threads"), activity_log=str(self.store / "activity.jsonl"),
                        mockup_dir=str(self.store / "mock" / "{thread}"))
        self.assertEqual(notepad.notepad_root(self.project, config.notepad_dir), self.store / "threads")
        self.assertEqual(activity_log.activity_path(self.project, config), self.store / "activity.jsonl")
        self.assertEqual(notepad.mockup_dir(self.project, self.store / "threads", config, "Demo"), self.store / "mock" / "demo")

    def test_new_thread_is_written_to_the_external_dir(self):
        config = self.tmp / "config.json"
        config.write_text(json.dumps({"notepad_dir": str(self.store / "threads")}))
        notepad.main(["new", "--project", str(self.project), "--config", str(config),
                      "demo", "--title", "Demo", "--apply"])
        self.assertTrue((self.store / "threads" / "demo" / "notepad.md").is_file())
        self.assertFalse((self.project / "context-notepad").exists())


if __name__ == "__main__":
    unittest.main()
