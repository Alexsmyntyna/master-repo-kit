import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import agenda  # noqa: E402

REAL_ROOT = agenda.ROOT
THREAD = "holding/threads/chat"


class Agenda(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        agenda.ROOT = root = Path(self.tmp.name)
        (root / "holding" / "threads" / "chat").mkdir(parents=True)
        (root / "holding" / "threads" / "chat" / "thread.md").write_text("---\nmode: chat\n---\n")
        (root / "companies" / "shop").mkdir(parents=True)
        (root / "companies" / "shop" / "company.json").write_text('{"name": "Shop"}')
        self.file = root / "holding" / "calendar.json"
        self.file.write_text(json.dumps({"updated": "2026-10-01", "entries": [
            {"id": "wedding", "title": "Wedding", "kind": "due", "date": "2026-10-15", "about": "Client · B&B",
             "mine": "kept", "steps": [{"id": "light", "text": "Check sunset", "done": False}],
             "source": {"source": "owner", "ref": "dump", "date": "2026-10-12"}},
            {"id": "do", "title": "DigitalOcean", "kind": "check", "cadence": "weekly", "last_done": "2026-10-05"},
        ]}, ensure_ascii=False, indent=2) + "\n")
        (root / "holding" / "pulse.json").write_text(json.dumps({"projects": [
            {"slug": "quiet", "tier": "focus", "state": "dormant", "idle_days": 40},
            {"slug": "booked", "tier": "paused", "state": "dormant", "next_check": "2026-10-18"},
            {"slug": "parked", "tier": "paused", "state": "dormant"},
        ]}))
        os.environ.pop(agenda.CHAT_PIN, None)

    def tearDown(self):
        agenda.ROOT = REAL_ROOT
        os.environ.pop(agenda.CHAT_PIN, None)
        self.tmp.cleanup()

    def run_cmd(self, *args):
        agenda.main(list(args))
        return json.loads(self.file.read_text())

    def test_add_records_the_thread_and_his_words_and_keeps_the_file_as_it_was(self):
        data = self.run_cmd("--by", THREAD, "add", "--title", "List 5 more pieces", "--date", "2026-10-16",
                            "--time", "18:30", "--end", "20:30", "--project", "shop", "--step", "Shoot", "--step", "List",
                            "--quote", "list stuff friday night")
        e = data["entries"][-1]
        self.assertEqual((e["id"], e["kind"], e["time"], e["end"]), ("list-5-more-pieces", "block", "18:30", "20:30"))
        self.assertEqual([s["text"] for s in e["steps"]], ["Shoot", "List"])
        self.assertEqual(e["source"]["source"], "agent")
        self.assertIn(THREAD, e["source"]["ref"])
        self.assertIn("list stuff friday night", e["source"]["ref"])
        self.assertEqual(data["entries"][0]["mine"], "kept")
        self.assertIn("Client · B&B", self.file.read_text())  # not ·
        self.assertTrue(self.file.read_text().endswith("}\n"))

    def test_a_taken_id_gets_the_date(self):
        self.run_cmd("--by", THREAD, "add", "--title", "Wedding", "--kind", "due", "--date", "2026-11-01")
        self.assertEqual(json.loads(self.file.read_text())["entries"][-1]["id"], "wedding-2026-11-01")

    def test_writes_are_checked(self):
        bad = [
            ("add", "--title", "X", "--date", "2026-10-16"),  # no --by
        ]
        for args in bad:
            with self.assertRaises(SystemExit):
                agenda.main(list(args))
        for args in [
            ("add", "--title", "Work", "--time", "18:00"),  # a block needs a day
            ("add", "--title", "Work", "--date", "2026-10-16", "--time", "18:00", "--end", "17:00"),
            ("add", "--title", "Work", "--date", "2026-02-30"),
            ("add", "--title", "Work", "--date", "2026-10-16", "--project", "nope"),
            ("add", "--title", "Work", "--date", "2026-10-16", "--link", "x=javascript:alert(1)"),
            ("remove", "wedding"),  # the owner's own entry
            ("add", "--title", "Work", "--date", "2026-10-16", "--spread"),  # spread goes with --auto
            ("add", "--title", "Work", "--auto", "--time", "10:00"),  # auto work isn't given a time
            ("done", "do", "--undo"),
            ("move", "do", "--date", "2026-10-20"),
        ]:
            with self.assertRaises(SystemExit, msg=args):
                agenda.main(["--by", THREAD, *args])
        with self.assertRaises(SystemExit):
            agenda.main(["--by", "../etc", "add", "--title", "X", "--kind", "due"])
        self.assertEqual(len(json.loads(self.file.read_text())["entries"]), 2)

    def test_a_chat_run_writes_only_in_its_own_name(self):
        other = agenda.ROOT / "holding" / "threads" / "other"
        other.mkdir()
        (other / "thread.md").write_text("---\n---\n")
        os.environ[agenda.CHAT_PIN] = THREAD
        with self.assertRaises(SystemExit):
            agenda.main(["--by", "holding/threads/other", "add", "--title", "X", "--kind", "due"])
        self.run_cmd("--by", THREAD, "add", "--title", "X", "--kind", "due")

    def test_move_step_done_and_remove(self):
        self.run_cmd("--by", THREAD, "add", "--title", "Shoot", "--date", "2026-10-17", "--time", "10:00", "--end", "14:00")
        data = self.run_cmd("--by", THREAD, "move", "shoot", "--date", "2026-10-18", "--time", "13:00", "--end", "16:00")
        self.assertEqual([data["entries"][-1][k] for k in ("date", "time", "end")], ["2026-10-18", "13:00", "16:00"])
        data = self.run_cmd("--by", THREAD, "step", "wedding", "light")
        self.assertTrue(data["entries"][0]["steps"][0]["done"])
        data = self.run_cmd("--by", THREAD, "step", "wedding", "light", "--undo")
        self.assertNotIn("done_on", data["entries"][0]["steps"][0])
        data = self.run_cmd("--by", THREAD, "done", "do")
        self.assertEqual(data["entries"][1]["last_done"], agenda.today_local())
        data = self.run_cmd("--by", THREAD, "rename", "shoot", "--title", "Studio shoot")
        self.assertEqual([data["entries"][-1][k] for k in ("id", "title")], ["shoot", "Studio shoot"])
        data = self.run_cmd("--by", THREAD, "rename", "shoot", "--type", "client")
        self.assertEqual(data["entries"][-1]["type"], "client")
        data = self.run_cmd("--by", THREAD, "rename", "shoot", "--type", "")
        self.assertNotIn("type", data["entries"][-1])
        with self.assertRaises(SystemExit):
            agenda.main(["--by", THREAD, "rename", "shoot", "--type", "nope"])
        data = self.run_cmd("--by", THREAD, "remove", "shoot")
        self.assertEqual([e["id"] for e in data["entries"]], ["wedding", "do"])
        data = self.run_cmd("--by", THREAD, "done", "wedding")  # done is its own call, steps untouched
        self.assertEqual([data["entries"][0][k] for k in ("done", "done_on")], [True, agenda.today_local()])
        self.assertFalse(data["entries"][0]["steps"][0]["done"])
        data = self.run_cmd("--by", THREAD, "done", "wedding", "--undo")
        self.assertFalse(data["entries"][0]["done"])
        self.assertNotIn("done_on", data["entries"][0])

    def test_auto_work_is_scheduled_and_rolls_on(self):
        self.run_cmd("--by", THREAD, "add", "--title", "Edit", "--date", "2026-10-26", "--auto", "--spread", "--hours", "4",
                     "--step", "Cull", "--step", "Grade")
        data = json.loads(self.file.read_text())
        self.assertEqual([data["entries"][-1].get(k) for k in ("auto", "spread", "hours")], [True, True, 4])
        items = [i for i in agenda.occurrences(data, "2026-10-26", "2026-11-01", "2026-10-26", 9 * 60) if i["id"] == "edit"]
        self.assertEqual([(i["when"], i["time"]) for i in items], [("2026-10-26", None), ("2026-10-27", None)])
        later = agenda.occurrences(data, "2026-10-26", "2026-11-08", "2026-10-31", 9 * 60)  # a Saturday: on to Monday
        self.assertEqual([i["when"] for i in later if i["id"] == "edit"], ["2026-11-02", "2026-11-03"])
        self.assertNotIn("edit", [e["id"] for e in agenda.undated(data)])
        data = self.run_cmd("--by", THREAD, "move", "edit", "--date", "2026-10-27", "--time", "14:00")  # pinned
        items = [i for i in agenda.occurrences(data, "2026-10-26", "2026-10-28", "2026-10-26", 9 * 60) if i["id"] == "edit"]
        self.assertEqual([(i["when"], i["time"]) for i in items], [("2026-10-27", "14:00")])
        rolled = [i for i in agenda.occurrences(data, "2026-10-28", "2026-10-28", "2026-10-28", 9 * 60) if i["id"] == "edit"]
        self.assertEqual([(i["when"], i["time"]) for i in rolled], [("2026-10-28", None)])

    def test_workday_and_routine(self):
        self.run_cmd("--by", THREAD, "workday", "--end", "22:00", "--late", "22:00", "--days", "0,1,2,3,4,5,6",
                     "--routine", "Church|0|09:30|13:00")
        data = self.run_cmd("--by", THREAD, "workday", "--routine", "Church|0|10:00|13:00")  # same title replaces
        self.assertEqual(data["workday"]["routine"], [{"title": "Church", "days": [0], "start": "10:00", "end": "13:00"}])
        for bad in (["--end", "08:00"], ["--days", "7"], ["--routine", "Church|0|13:00|10:00"]):
            with self.assertRaises(SystemExit, msg=bad):
                agenda.main(["--by", THREAD, "workday", *bad])
        rows = [i for i in agenda.occurrences(data, "2026-10-25", "2026-10-26", "2026-10-25", 0) if i["from"] == "routine"]
        self.assertEqual([(i["when"], i["time"]) for i in rows], [("2026-10-25", "10:00")])

    def test_occurrences_repeat_checks_and_add_pulse_rows(self):
        items = agenda.occurrences(agenda.load(), "2026-10-12", "2026-10-25", "2026-10-12")
        self.assertEqual([i["when"] for i in items if i["id"] == "do"], ["2026-10-12", "2026-10-19"])
        self.assertIn(("pulse:quiet", "2026-10-12", "Gone quiet"), [(i["id"], i["when"], i["title"]) for i in items])
        self.assertIn(("pulse:booked", "2026-10-18", "Check-in"), [(i["id"], i["when"], i["title"]) for i in items])
        self.assertNotIn("pulse:parked", [i["id"] for i in items])
        self.assertEqual(agenda.add_cadence("2026-01-31", "monthly"), "2026-02-28")
        self.assertEqual(agenda.add_cadence("2026-11-30", "quarterly"), "2027-02-28")

    def test_brief_draws_stats_and_a_flow_per_day(self):
        text = agenda.brief("2026-10-12", "2026-10-18", "2026-10-12", now=8 * 60)
        self.assertIn("```stats", text)
        self.assertIn("3d | to Wedding", text)
        self.assertIn("**Thu 2026-10-15**\n```flow\nWedding | Client · B&B · 0/1 steps | risk", text)
        self.assertIn("Check sunset", text)


if __name__ == "__main__":
    unittest.main()
