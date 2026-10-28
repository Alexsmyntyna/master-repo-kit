"""Run with: python3 -m unittest tools/test_contradict.py"""
import datetime as dt
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import card  # noqa: E402
import contradict  # noqa: E402
import converse  # noqa: E402
import refresh  # noqa: E402

TODAY = dt.date.today()


def D(n: int) -> str:
    return (TODAY - dt.timedelta(days=n)).isoformat()


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def refs(pairs: list[dict]) -> set[tuple[str, str]]:
    return {(p["a"]["ref"].rsplit("#", 1)[-1], p["b"]["ref"].rsplit("#", 1)[-1]) for p in pairs}


class Contradict(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()
        self.co = self.root / "companies" / "cam"
        write(self.co / "company.json", json.dumps({"id": "cam", "name": "Cam"}))
        (self.root / "holding").mkdir()
        self.saved = (contradict.ROOT, contradict.ask_judge, converse.log_run)
        contradict.ROOT = self.root
        self.runs = []
        converse.log_run = self.runs.append

    def tearDown(self):
        contradict.ROOT, contradict.ask_judge, converse.log_run = self.saved
        self.tmp.cleanup()

    def android_and_ios(self):
        write(self.co / "decisions.json", json.dumps([
            {"id": "CAM-DEC-001", "date": D(25), "decision": "iOS only until the beta has 10 testers",
             "source": {"type": "alex", "ref": "chat", "date": D(25)}},
            {"id": "CAM-DEC-002", "date": D(25), "decision": "Agent suggestion about Android", "source": "agent"}]))
        write(self.co / "threads" / "t" / "001-owner.md",
              f'---\nfrom: "owner"\nto: "coo"\nkind: "reply"\ndate: "{D(2)}"\n---\n\n'
              "Let's get the Android build going this week.\n")

    def fake_judge(self, conflict=True):
        calls = []

        def ask(prompt, model):
            calls.append(prompt)
            ids = [ln[4:] for ln in prompt.splitlines() if ln.startswith("### ")]
            question = "Android this week, or iOS only until 10 testers?" if conflict else ""
            return [{"id": i, "conflict": conflict, "question": question} for i in ids], {"turns": 1}
        contradict.ask_judge = ask
        return calls

    def stored(self):
        return json.loads((self.co / "contradictions.json").read_text())

    def test_collects_every_source_with_legacy_and_nested_owner_values(self):
        write(self.co / "decisions.json", json.dumps([
            {"id": "D1", "date": D(9), "decision": "Pricing stays at nine dollars", "source": "owner"},
            {"id": "D2", "date": D(8), "decision": "Nested alex source counts", "source": {"type": "alex", "date": D(8)}},
            {"id": "D3", "date": D(7), "decision": "An agent proposal does not count", "source": {"type": "agent"}}]))
        write(self.co / "threads" / "t" / "001-alex.md",
              f'---\nfrom: "alex"\nkind: "reply"\ndate: "{D(6)}"\n---\n\nShip the camera app to the store first.\n')
        write(self.co / "threads" / "t" / "002-coo.md",
              f'---\nfrom: "coo"\nkind: "report"\ndate: "{D(5)}"\n---\n\nThe coo wrote this long enough sentence.\n')
        write(self.co / "threads" / "t" / "003-alex.md",
              f'---\nfrom: "alex"\nkind: "directive"\ndate: "{D(4)}"\n---\n\nStanding check-in from the scheduler today.\n')
        write(self.co / "notes" / "n.md",
              f'---\nwritten_by: owner\ndate: {D(3)}\n---\n\n# Heading\n\nThe landing page waits for the store.\n')
        write(self.co / "notes" / "agent.md", f'---\nwritten_by: agent\ndate: {D(3)}\n---\n\nAgent prose that is long enough.\n')
        write(self.co / "wiki" / "fronts" / "f.md",
              f'---\ntitle: F\nkind: front\nsummary: "Sync between devices drops voice notes."\ndate: {D(2)}\nraised_by: alex\n---\n\nBody.\n')
        write(self.co / "card.json", json.dumps({"goal": {"text": "First sale through the site.", "source": "owner", "date": D(1)},
                                                  "next": {"text": "Agent step here.", "source": "agent", "date": D(1)}}))
        found = contradict.collect("cam", self.root)
        self.assertEqual(sorted((s["kind"], s["text"]) for s in found), [
            ("card", "First sale through the site."),
            ("decision", "Nested alex source counts"),
            ("decision", "Pricing stays at nine dollars"),
            ("note", "Sync between devices drops voice notes."),
            ("note", "The landing page waits for the store."),
            ("thread", "Ship the camera app to the store first.")])
        by_text = {s["text"]: s["ref"] for s in found}
        self.assertEqual(by_text["Pricing stays at nine dollars"], "companies/cam/decisions.json#D1")
        self.assertTrue(by_text["Ship the camera app to the store first."].endswith("001-alex.md:7"))

    def test_android_and_ios_statements_pair(self):
        self.android_and_ios()
        pairs = contradict.candidates("cam", self.root)
        self.assertEqual(len(pairs), 1)
        self.assertIn("iOS only", pairs[0]["a"]["text"])
        self.assertIn("Android build", pairs[0]["b"]["text"])
        self.assertLess(pairs[0]["a"]["date"], pairs[0]["b"]["date"])

    def test_unrelated_old_and_cited_pairs_do_not(self):
        write(self.co / "decisions.json", json.dumps([
            {"id": "D1", "date": D(20), "decision": "Pricing stays at nine dollars a month", "source": "owner"},
            {"id": "D2", "date": D(3), "decision": "Dark mode comes before anything else", "source": "owner"},
            {"id": "D3", "date": D(3), "decision": "Pricing is nine dollars on the web", "source": "owner"},
            {"id": "D4", "date": D(60), "decision": "iOS only until ten beta testers", "source": "owner"},
            {"id": "D5", "date": D(59), "decision": "Android build waits for beta testers", "source": "owner"},
            {"id": "D6", "date": D(2), "decision": "Pricing is now twelve dollars a month", "source": "owner",
             "refs": ["companies/cam/decisions.json#D1"]}]))
        pairs = refs(contradict.candidates("cam", self.root))
        self.assertIn(("D1", "D3"), pairs)
        self.assertNotIn(("D1", "D6"), pairs)  # the newer cites the older
        self.assertFalse([p for p in pairs if "D2" in p])  # unrelated topic
        self.assertFalse([p for p in pairs if "D4" in p or "D5" in p])  # newer one is outside 30 days
        self.assertIn(("D4", "D5"), refs(contradict.candidates("cam", self.root, days=90)))

    def test_judged_pairs_are_stored_and_never_judged_again(self):
        self.android_and_ios()
        calls = self.fake_judge()
        self.assertEqual(contradict.judge("cam", self.root, 30, "sonnet"), (1, 1, False))
        stored = self.stored()
        self.assertEqual(len(stored), 1)
        self.assertEqual((stored[0]["status"], stored[0]["conflict"]), ("open", True))
        self.assertEqual(stored[0]["found"], TODAY.isoformat())
        self.assertEqual(set(stored[0]["a"]), {"text", "date", "ref"})
        self.assertEqual(self.runs[-1]["task"], "contradict")
        self.assertEqual(contradict.judge("cam", self.root, 30, "sonnet"), (0, 0, False))
        self.assertEqual(len(calls), 1)

    def test_no_conflict_is_stored_as_none_and_kept(self):
        self.android_and_ios()
        self.fake_judge(conflict=False)
        contradict.judge("cam", self.root, 30, "sonnet")
        self.assertEqual(self.stored()[0]["status"], "none")
        self.assertEqual(contradict.pending("cam", self.root), [])
        self.assertEqual(contradict.open_count("cam", self.root), 0)

    def test_a_limit_stops_and_stores_nothing(self):
        self.android_and_ios()
        contradict.ask_judge = lambda prompt, model: (None, {"error": "usage limit reached", "limit": True})
        self.assertEqual(contradict.judge("cam", self.root, 30, "sonnet"), (0, 0, True))
        self.assertFalse((self.co / "contradictions.json").exists())
        self.assertEqual(len(contradict.pending("cam", self.root)), 1)
        self.assertFalse(self.runs[-1]["ok"])

    def test_resolve_writes_a_decision_and_closes_the_pair(self):
        self.android_and_ios()
        self.fake_judge()
        contradict.judge("cam", self.root, 30, "sonnet")
        d = contradict.resolve("cam", self.stored()[0]["id"], "a", "Beta first.", self.root)
        decisions = json.loads((self.co / "decisions.json").read_text())
        self.assertEqual(decisions[-1], d)
        self.assertEqual(d["id"], "CAM-DEC-003")
        self.assertEqual(d["decision"], "Holds: iOS only until the beta has 10 testers")
        self.assertEqual(d["source"]["type"], "owner")
        self.assertEqual(len(d["refs"]), 2)
        self.assertEqual((self.stored()[0]["status"], self.stored()[0]["resolved"]["keep"]), ("resolved", "a"))
        self.assertEqual(contradict.open_count("cam", self.root), 0)
        self.assertEqual(contradict.pending("cam", self.root), [])  # the decision cites both, so it pairs with neither

    def test_dismiss(self):
        self.android_and_ios()
        self.fake_judge()
        contradict.judge("cam", self.root, 30, "sonnet")
        contradict.dismiss("cam", self.stored()[0]["id"], self.root)
        self.assertEqual(self.stored()[0]["status"], "dismissed")
        self.assertNotIn("Holds", (self.co / "decisions.json").read_text())

    def test_open_contradictions_show_on_the_card_and_in_the_refresh_line(self):
        self.android_and_ios()
        self.assertIn("1 candidate pairs to judge in 1 projects, 0 open", refresh.contradictions_line(self.root))
        self.fake_judge()
        contradict.judge("cam", self.root, 30, "sonnet")
        self.assertEqual(card.owes("cam", self.root)["contradictions"], 1)
        self.assertIn("0 candidate pairs to judge in 0 projects, 1 open", refresh.contradictions_line(self.root))


if __name__ == "__main__":
    unittest.main()
