"""Run with: python3 -m unittest tools/test_skills.py"""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import skills  # noqa: E402

SKILL = '---\nname: {name}\ntitle: T\nscope: any\nstatus: {status}\nparams: [project]\nkind: task\nwhen: "the owner says \\"hi\\", it\'s time."\n---\n\nBody\n'


class Sync(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "skills").mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, status="ready"):
        (self.root / "skills" / f"{name}.md").write_text(SKILL.format(name=name, status=status))

    def test_sync_writes_index_and_wrappers_and_removes_stale_ones(self):
        self.write("alpha")
        self.write("beta", status="placeholder")
        skills.sync(self.root)
        index = (self.root / "skills" / "INDEX.md").read_text()
        self.assertIn('the owner says "hi", it\'s time.', index)
        self.assertIn("*(placeholder)*", index)
        self.assertTrue((self.root / ".claude/skills/alpha/SKILL.md").exists())
        self.assertFalse((self.root / ".claude/skills/beta").exists())
        self.assertEqual(skills.check(self.root), 0)
        (self.root / "skills" / "alpha.md").unlink()
        self.assertEqual(skills.check(self.root), 1)
        skills.sync(self.root)
        self.assertFalse((self.root / ".claude/skills/alpha").exists())

    def test_hand_written_claude_skills_are_left_alone(self):
        own = self.root / ".claude/skills/mine/SKILL.md"
        own.parent.mkdir(parents=True)
        own.write_text("---\nname: mine\ndescription: x\n---\n")
        skills.sync(self.root)
        self.assertTrue(own.exists())

    def test_bad_skill_is_reported(self):
        (self.root / "skills" / "wrong.md").write_text(SKILL.format(name="other", status="ready"))
        self.assertEqual(skills.check(self.root), 1)


class Local(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "skills").mkdir()
        (self.root / "local/skills").mkdir(parents=True)
        for name in ("alpha", "beta"):
            (self.root / "skills" / f"{name}.md").write_text(SKILL.format(name=name, status="ready"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_local_overrides_adds_and_disables(self):
        override = skills.override("alpha", self.root)
        override.write_text(override.read_text().replace("Body", "Mine"))
        (self.root / "local/skills/gamma.md").write_text(SKILL.format(name="gamma", status="ready"))
        (self.root / "local/skills/beta.md").write_text("---\nname: beta\ndisabled: true\n---\n")
        skills.sync(self.root)
        index = (self.root / "skills" / "INDEX.md").read_text()
        self.assertIn("[alpha](../local/skills/alpha.md)", index)
        self.assertIn("[gamma](../local/skills/gamma.md)", index)
        self.assertNotIn("[beta]", index)
        self.assertIn("local copies", index)
        self.assertIn("`local/skills/alpha.md`", (self.root / ".claude/skills/alpha/SKILL.md").read_text())
        self.assertFalse((self.root / ".claude/skills/beta").exists())
        self.assertEqual(skills.check(self.root), 0)

    def test_drift_is_noted_when_the_shipped_skill_changes(self):
        skills.override("alpha", self.root)
        self.assertEqual(skills.drifted(self.root), [])
        base = self.root / "skills/alpha.md"
        base.write_text(base.read_text().replace("Body", "Better body"))
        self.assertEqual(len(skills.drifted(self.root)), 1)
        skills.sync(self.root)
        self.assertEqual(skills.check(self.root), 0)  # drift is a note, not a failure

    def test_override_refuses_unknown_or_existing(self):
        with self.assertRaises(ValueError):
            skills.override("nope", self.root)
        skills.override("alpha", self.root)
        with self.assertRaises(ValueError):
            skills.override("alpha", self.root)


if __name__ == "__main__":
    unittest.main()
