"""Run with: python3 -m unittest tools/test_portfolio.py"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import converse  # noqa: E402
import git_history  # noqa: E402
import portfolio  # noqa: E402

MODULES = (converse, git_history, portfolio)
REAL = {m: m.ROOT for m in MODULES}
CARD = ("Park it; the plugin works.\n\n```release\npublished: partly\nchannel: plugin\nlanding_page: none\n"
        "verdict: park\ncadence: monthly\nnext_step: Add a download page on example.com\n```")


class Portfolio(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        for m in MODULES:
            m.ROOT = self.root
        self.repo = self.root / "code" / "tagger"
        self.repo.mkdir(parents=True)
        env = {**os.environ, "GIT_AUTHOR_DATE": "2026-01-05T10:00:00", "GIT_COMMITTER_DATE": "2026-01-05T10:00:00"}
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        for i in range(3):
            (self.repo / f"f{i}.py").write_text(str(i))
            subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
            subprocess.run(["git", "-C", str(self.repo), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm",
                            f"Add feature {i}"], check=True, env=env)
        company = self.root / "companies" / "tagger"
        company.mkdir(parents=True)
        (company / "company.json").write_text(json.dumps(
            {"id": "tagger", "name": "Tagger", "repos": [{"path": str(self.repo), "subdir": None}]}))
        (self.root / "agents").mkdir()
        for role in ("ceo", "coo"):
            (self.root / "agents" / f"{role}.md").write_text(f"---\nrole: {role}\n---\n\nYou are the {role}.\n")
        (self.root / "holding").mkdir()
        (self.root / "holding" / "portfolio.json").write_text(json.dumps({"undecided": ["tagger"]}))

    def tearDown(self):
        for m, root in REAL.items():
            m.ROOT = root
        self.tmp.cleanup()

    def test_pulse_reads_git_and_flags_old_projects(self):
        [row] = portfolio.pulse()
        self.assertEqual((row["last_commit"], row["commits"], row["unread"]), ("2026-01-05", 3, 3))
        self.assertIn(row["state"], ("dormant", "abandoned"))
        self.assertTrue((self.root / "holding" / "pulse.json").exists())
        self.assertIn("3 unread", converse.project_brief("tagger"))
        self.assertEqual(portfolio.due([row])[0][1], ["no release card yet"])

    def test_checkin_digests_work_and_approval_applies_the_card(self):
        [row] = portfolio.pulse()
        thread = portfolio.checkin(row, ["no release card yet"])
        meta, _ = converse.read_thread(thread)
        self.assertTrue(meta["checkin"])
        self.assertIn("Add feature 2", (self.root / meta["digest"]).read_text())
        self.assertIn("```release", converse.messages(thread)[0][2])
        self.assertEqual(portfolio.due([row]), [])  # an open check-in isn't opened twice
        converse.add_message(thread, "coo", "owner", "decision", CARD, "Park the tagger")
        converse.main(["approve", str(thread)])
        release = json.loads((self.root / "companies" / "tagger" / "company.json").read_text())["release"]
        self.assertEqual((release["verdict"], release["channel"], release["landing_page"]), ("park", "plugin", None))
        self.assertEqual(release["state_at_check"], row["state"])
        self.assertIsNotNone(release["next_check"])
        tiers = json.loads((self.root / "holding" / "portfolio.json").read_text())
        self.assertEqual((tiers["paused"], tiers["undecided"]), (["tagger"], []))
        self.assertEqual(portfolio.pulse_one("tagger")["unread"], 0)

    def test_off_main_work_is_read_and_makes_a_checkin_due(self):
        git = ["git", "-C", str(self.repo), "-c", "user.name=t", "-c", "user.email=t@t"]
        main = subprocess.run(git + ["branch", "--show-current"], capture_output=True, text=True).stdout.strip()
        subprocess.run(git + ["checkout", "-qb", "experiment"], check=True)
        (self.repo / "new.py").write_text("x")
        subprocess.run(git + ["add", "."], check=True)
        subprocess.run(git + ["commit", "-qm", "Try a new idea"], check=True)
        subprocess.run(git + ["checkout", "-q", main], check=True)
        (self.repo / "f0.py").write_text("changed")
        row = portfolio.pulse_one("tagger")
        self.assertEqual((row["uncommitted"], row["branches"]), (1, 1))
        text = portfolio.off_main_text("tagger")
        self.assertIn("Branch `experiment`", text)
        self.assertIn("Try a new idea", text)
        thread = portfolio.checkin(row, ["test"])
        self.assertIn("What isn't on main yet?", converse.messages(thread)[0][2])
        converse.add_message(thread, "coo", "owner", "decision", CARD, "Park")
        converse.main(["approve", str(thread)])
        self.assertEqual(portfolio.due_reasons(portfolio.pulse_one("tagger")), [])  # reviewed, nothing new
        (self.repo / "f1.py").write_text("changed too")
        self.assertIn("work off main changed (uncommitted, branches or worktrees)",
                      portfolio.due_reasons(portfolio.pulse_one("tagger")))

    def test_approving_a_card_never_takes_a_project_out_of_focus(self):
        (self.root / "holding" / "portfolio.json").write_text(json.dumps({"focus": ["tagger"]}))
        [row] = portfolio.pulse()
        thread = portfolio.checkin(row, ["test"])
        converse.add_message(thread, "coo", "ceo", "report", "x")
        converse.add_message(thread, "ceo", "owner", "decision", CARD, "Park")
        converse.main(["approve", str(thread)])
        self.assertEqual(json.loads((self.root / "holding" / "portfolio.json").read_text())["focus"], ["tagger"])

    def test_bad_cards_are_ignored(self):
        self.assertIsNone(portfolio.parse_card("no card"))
        self.assertIsNone(portfolio.parse_card(CARD.replace("verdict: park", "verdict: maybe")))
        self.assertEqual(portfolio.parse_card(CARD)["next_step"], "Add a download page on example.com")
        self.assertEqual(portfolio.parse_card(CARD.rstrip("`\n"))["cadence"], "monthly")  # unclosed fence
        self.assertIsNone(portfolio.parse_card(CARD.replace("landing_page: none", "landing_page: javascript:alert(1)"))["landing_page"])
        self.assertEqual(portfolio.parse_card(CARD.replace("landing_page: none", "landing_page: https://example.com/x"))["landing_page"],
                         "https://example.com/x")


if __name__ == "__main__":
    unittest.main()
