"""Run with: python3 -m unittest tools/test_recheck.py"""
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import card  # noqa: E402
import converse  # noqa: E402
import footprint  # noqa: E402
import recheck  # noqa: E402

MODULES = (card, converse, footprint, recheck)
REAL = {m: m.ROOT for m in MODULES}
TODAY = dt.date.today()
OLD = (TODAY - dt.timedelta(days=10)).isoformat()
YESTERDAY = (TODAY - dt.timedelta(days=1)).isoformat()
ENV = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


class Recheck(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name).resolve()
        self.root = base / "master"
        for m in MODULES:
            m.ROOT = self.root
        self.repo = base / "code" / "shop"
        self.repo.mkdir(parents=True)
        self.git("init", "-q")
        self.commit("first", f"{OLD}T09:00:00")
        co = self.root / "companies" / "shop"
        write(co / "company.json", json.dumps({"id": "shop", "name": "Shop", "repos": [{"path": str(self.repo)}]}))
        write(co / "git" / "snapshot.json", json.dumps({"repos": [
            {"label": "shop", "path": str(self.repo), "subdir": None},
            {"label": "gone", "path": str(base / "missing"), "subdir": None}]}))
        write(self.root / "holding" / "runs.jsonl", "")
        # a thread asked 10 days ago, one asked today, one already decided
        write(co / "threads" / "a" / "thread.md",
              '---\ntitle: "Ship it?"\nstatus: "awaiting-owner"\nparticipants: ["owner", "ceo", "coo"]\nmessages: 1\n'
              'last_from: "coo"\n---\n\n')
        write(co / "threads" / "a" / "001-coo.md",
              f'---\nfrom: "coo"\nto: "owner"\nkind: "decision"\ndate: "{OLD}"\nsubject: "Ship"\n---\n\nShould we add checkout?\n')
        write(co / "threads" / "b" / "thread.md", '---\nstatus: "awaiting-owner"\n---\n\n')
        write(co / "threads" / "b" / "001-coo.md", f'---\nfrom: "coo"\nkind: "question"\ndate: "{TODAY}"\n---\n\nx\n')
        write(co / "threads" / "c" / "thread.md", '---\nstatus: "decided"\n---\n\n')
        write(co / "threads" / "c" / "001-coo.md", f'---\nfrom: "coo"\nkind: "report"\ndate: "{OLD}"\n---\n\nx\n')
        write(co / "builds" / "b1" / "build.md",
              f'---\ntitle: "One"\nstatus: "review"\nupdated: "{OLD}T10:00:00"\n---\n\nbody\n')
        write(co / "card.json", json.dumps({
            "slug": "shop", "blocker": {"text": "No checkout", "source": "code", "ref": "x", "date": OLD},
            "next": {"text": "Add checkout", "source": "agent", "ref": "y", "date": TODAY.isoformat()},
            "updated": OLD}, indent=2))
        self.co = co

    def tearDown(self):
        for m, root in REAL.items():
            m.ROOT = root
        self.tmp.cleanup()

    def git(self, *args, when=None):
        env = {**os.environ, **ENV, **({"GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when} if when else {})}
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True, text=True, env=env)

    def commit(self, name: str, when: str):
        write(self.repo / f"{name}.txt", name)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", name, when=when)

    def card_json(self) -> dict:
        return json.loads((self.co / "card.json").read_text())

    def test_scan_flags_only_questions_older_than_new_commits(self):
        self.commit("checkout", f"{YESTERDAY}T12:00:00")
        flagged = {f["ref"]: f for f in recheck.scan(self.root, ["shop"])}
        self.assertEqual(sorted(flagged), ["companies/shop/builds/b1", "companies/shop/card.json#blocker",
                                           "companies/shop/threads/a"])
        self.assertEqual(flagged["companies/shop/threads/a"]["commits"], 1)  # the first commit was the same day
        thread = (self.co / "threads" / "a" / "thread.md").read_text()
        self.assertIn("recheck_commits: 1\n", thread)
        self.assertIn(f'recheck_since: "{OLD}"\n', thread)
        self.assertIn('status: "awaiting-owner"', thread)
        self.assertNotIn("recheck", (self.co / "threads" / "b" / "thread.md").read_text())
        c = self.card_json()
        self.assertEqual(c["blocker"]["recheck"], {"commits": 1, "since": OLD})
        self.assertNotIn("recheck", c["next"])
        self.assertEqual(c["blocker"]["text"], "No checkout")

    def test_scan_clears_the_flag_once_rechecked_after_the_commits(self):
        self.commit("checkout", f"{YESTERDAY}T12:00:00")
        recheck.scan(self.root, ["shop"])
        recheck.set_meta(self.co / "threads" / "a" / "thread.md", {"rechecked": TODAY.isoformat()})
        flagged = [f["ref"] for f in recheck.scan(self.root, ["shop"])]
        self.assertNotIn("companies/shop/threads/a", flagged)
        thread = (self.co / "threads" / "a" / "thread.md").read_text()
        self.assertNotIn("recheck_commits", thread)
        self.assertIn("Should we add checkout?", (self.co / "threads" / "a" / "001-coo.md").read_text())

    def test_scan_clears_the_flag_once_alex_answers(self):
        self.commit("checkout", f"{YESTERDAY}T12:00:00")
        recheck.scan(self.root, ["shop"])
        t = self.co / "threads" / "a" / "thread.md"
        recheck.set_meta(t, {"status": "decided"})
        recheck.scan(self.root, ["shop"])
        self.assertNotIn("recheck_commits", t.read_text())
        self.assertIn('status: "decided"', t.read_text())

    def test_subdir_limits_the_count(self):
        (self.repo / "app").mkdir()
        self.commit("outside", f"{YESTERDAY}T12:00:00")
        snap = self.co / "git" / "snapshot.json"
        snap.write_text(json.dumps({"repos": [{"label": "shop", "path": str(self.repo), "subdir": "app"}]}))
        self.assertEqual(recheck.scan(self.root, ["shop"]), [])

    def run_with(self, ref: str, answer: dict) -> str:
        self.commit("checkout", f"{YESTERDAY}T12:00:00")
        recheck.scan(self.root, ["shop"])
        seen = {}

        def fake(prompt, repos, model):
            seen["prompt"], seen["model"] = prompt, model
            # the running marker is visible while the agent works
            self.assertIn("recheck_running", (self.co / "card.json").read_text() if "card" in ref else
                          (self.root / ref / ("build.md" if "/builds/" in ref else "thread.md")).read_text())
            return answer, {"turns": 3}
        real, recheck.ask_agent = recheck.ask_agent, fake
        try:
            out = recheck.run_one(recheck.find(ref, self.root), "sonnet", self.root)
        finally:
            recheck.ask_agent = real
        self.assertIn("checkout", seen["prompt"])
        self.assertIn(str(self.repo), seen["prompt"])
        log = [json.loads(ln) for ln in (self.root / "holding" / "runs.jsonl").read_text().splitlines()]
        self.assertEqual((log[-1]["task"], log[-1]["model"], log[-1]["ok"]), ("recheck", "sonnet", True))
        self.assertIn("seconds", log[-1])
        return out

    def test_resolved_thread_gets_a_message_and_closes(self):
        self.run_with("companies/shop/threads/a", {"verdict": "resolved", "reason": "Checkout landed.",
                                                   "evidence": ["abc123 adds checkout"]})
        meta, _ = converse.read_thread(self.co / "threads" / "a")
        self.assertEqual(meta["status"], "closed")
        self.assertEqual(meta["rechecked"], TODAY.isoformat())
        self.assertNotIn("recheck_commits", meta)
        self.assertNotIn("recheck_running", meta)
        msg = (self.co / "threads" / "a" / "002-coo.md").read_text()
        self.assertIn("`abc123` adds checkout", msg)
        self.assertIn("Checkout landed.", msg)
        self.assertTrue((self.co / "threads" / "a" / "001-coo.md").exists())

    def test_rephrased_thread_stays_awaiting_with_the_new_question(self):
        self.run_with("companies/shop/threads/a", {"verdict": "rephrase", "reason": "Half done.",
                                                   "evidence": ["abc123 x"], "rewrite": "Should checkout take cards?"})
        meta, _ = converse.read_thread(self.co / "threads" / "a")
        self.assertEqual(meta["status"], "awaiting-owner")
        _, m, body = converse.messages(self.co / "threads" / "a")[-1]
        self.assertEqual(m["kind"], "decision")  # keeps the kind of the question it replaces
        self.assertTrue(body.startswith("Should checkout take cards?"))

    def test_resolved_card_line_keeps_its_text_and_is_left_alone_by_scan(self):
        self.run_with("companies/shop/card.json#blocker", {"verdict": "resolved", "reason": "Done.",
                                                           "evidence": ["abc123 x"]})
        b = self.card_json()["blocker"]
        self.assertEqual(b["text"], "No checkout")
        self.assertEqual(b["recheck"]["verdict"], "resolved")
        self.assertNotIn("recheck_running", b)
        recheck.scan(self.root, ["shop"])
        self.assertEqual(self.card_json()["blocker"]["recheck"]["verdict"], "resolved")

    def test_rephrased_card_line_keeps_the_old_text_in_previous(self):
        self.run_with("companies/shop/card.json#blocker", {"verdict": "rephrase", "reason": "Moved on.",
                                                           "evidence": ["abc123 x"], "rewrite": "No payments yet"})
        c = self.card_json()
        b = c["blocker"]
        self.assertEqual((b["text"], b["source"], b["date"]), ("No payments yet", "agent", TODAY.isoformat()))
        self.assertEqual(b["previous"][0]["text"], "No checkout")
        self.assertEqual(b["previous"][0]["date"], OLD)
        self.assertNotIn("recheck", b)
        self.assertEqual(c["updated"], TODAY.isoformat())
        flagged = [f["ref"] for f in recheck.scan(self.root, ["shop"])]
        self.assertNotIn("companies/shop/card.json#blocker", flagged)  # dated today now

    def test_valid_clears_the_flag_and_records_the_date(self):
        self.run_with("companies/shop/builds/b1", {"verdict": "valid", "reason": "Unrelated.", "evidence": []})
        meta = card.frontmatter(self.co / "builds" / "b1" / "build.md")
        self.assertEqual(meta["status"], "review")
        self.assertEqual(meta["rechecked"], TODAY.isoformat())
        self.assertEqual(meta["recheck_note"]["verdict"], "valid")
        self.assertNotIn("recheck_commits", meta)
        self.assertNotIn("companies/shop/builds/b1", [f["ref"] for f in recheck.scan(self.root, ["shop"])])

    def test_unreadable_answer_keeps_the_flag_and_logs_a_failure(self):
        self.commit("checkout", f"{YESTERDAY}T12:00:00")
        recheck.scan(self.root, ["shop"])
        real, recheck.ask_agent = recheck.ask_agent, lambda *a: ({"verdict": "maybe"}, {})
        try:
            recheck.run_one(recheck.find("companies/shop/threads/a", self.root), "sonnet", self.root)
        finally:
            recheck.ask_agent = real
        meta = card.frontmatter(self.co / "threads" / "a" / "thread.md")
        self.assertEqual(meta["recheck_commits"], 1)
        self.assertNotIn("recheck_running", meta)
        log = json.loads((self.root / "holding" / "runs.jsonl").read_text().splitlines()[-1])
        self.assertFalse(log["ok"])

    def test_card_refresh_counts_flagged_items_apart_from_owes(self):
        self.commit("checkout", f"{YESTERDAY}T12:00:00")
        recheck.scan(self.root, ["shop"])
        c = card.refresh("shop")
        self.assertEqual(c["recheck"], 3)
        self.assertNotIn("recheck", c["owes"])


if __name__ == "__main__":
    unittest.main()
