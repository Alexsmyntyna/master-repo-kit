"""Run with: python3 -m unittest tools/test_converse.py"""
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import converse  # noqa: E402

import portfolio  # noqa: E402
REAL_ROOT = converse.ROOT


class Threads(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home_patch = patch.object(Path, "home", return_value=Path(self.tmp.name).resolve())
        self.home_patch.start()
        self.addCleanup(self.home_patch.stop)
        self.root = Path(self.tmp.name).resolve() / "repo"
        self.root.mkdir()
        converse.ROOT = portfolio.ROOT = self.root
        company = self.root / "companies" / "demo"
        (company / "wiki" / "fronts").mkdir(parents=True)
        (company / "company.json").write_text(json.dumps({"id": "demo", "name": "Demo", "repos": []}))
        (company / "wiki" / "index.md").write_text("---\ntitle: Demo\n---\n\nWhy Demo exists.\n")
        (company / "wiki" / "fronts" / "speed.md").write_text(
            "---\ntitle: Too slow\nstatus: open\nsummary: Screens refresh too often.\n---\n\nBody\n")
        (company / "wiki" / "fronts" / "old.md").write_text("---\ntitle: Old\nstatus: settled\n---\n")
        (self.root / "agents").mkdir()
        for role in ("ceo", "coo"):
            (self.root / "agents" / f"{role}.md").write_text(f"---\nrole: {role}\n---\n\nYou are the {role}.\n")
        (self.root / "holding").mkdir()
        (self.root / "holding" / "direction.md").write_text("Ship weekly.")

    def tearDown(self):
        converse.ROOT = portfolio.ROOT = REAL_ROOT
        self.tmp.cleanup()

    def test_new_thread_writes_summary_file_and_first_message(self):
        t = converse.new_thread("demo", "Rebuild in React Native?", 'Is it viable? "Quotes" ok.')
        self.assertEqual(t.parent.name, "threads")
        meta, _ = converse.read_thread(t)
        self.assertEqual((meta["status"], meta["messages"]), ("open", 1))
        [(path, m, body)] = converse.messages(t)
        self.assertEqual((path.name, m["from"], m["to"], m["kind"]), ("001-owner.md", "owner", "coo", "directive"))
        self.assertIn('"Quotes"', body)
        self.assertEqual(converse.next_role(t), "coo")

    def test_what_alex_typed_is_kept_beside_the_spelling_fixed_body(self):
        typed = "teh hustory: dont lose it\n\n  indented line\n---\nnote: feilds"
        fixed = "the history: don't lose it\n\n  indented line\n---\nnote: fields"
        converse.main(["new", "demo", "Spelling", "--body", fixed, "--typed", typed])
        t = next((self.root / "companies" / "demo" / "threads").iterdir())
        path, m, body = converse.messages(t)[0]
        self.assertEqual((body, m["typed"], m["fixes"], m["from"]), (fixed, typed, 4, "owner"))
        self.assertNotIn("note", m)  # a colon inside the block isn't a key
        self.assertIn("typed: |\n  teh hustory: dont lose it\n\n    indented line\n  ---\n", path.read_text())
        self.assertNotIn("teh hustory", converse.build_prompt(t, "coo"))  # agents read the fixed words
        converse.main(["post", str(t), "--as", "owner", "--to", "coo", "--body", "Same words.", "--typed", "Same words."])
        self.assertNotIn("typed", converse.messages(t)[-1][1])  # nothing fixed, nothing extra stored
        converse.main(["post", str(t), "--as", "owner", "--to", "coo", "--body", "That's it.", "--typed", "Thats it."])
        self.assertEqual({k: converse.messages(t)[-1][1][k] for k in ("typed", "fixes")}, {"typed": "Thats it.", "fixes": 1})
        converse.main(["chat", "demo", "--body", "the end", "--typed", "teh end"])
        _, m, _ = converse.messages(self.root / "companies" / "demo" / "threads" / "chat")[0]
        self.assertEqual((m["typed"], m["fixes"], m["page"]), ("teh end", 1, False))
        converse.main(["approve", str(t), "--note", "Going with the history.", "--typed", "Going with the hustory."])
        _, m, body = converse.messages(t)[-1]
        self.assertEqual((m["kind"], body, m["typed"], m["fixes"]), ("approval", "Going with the history.", "Going with the hustory.", 1))

    def test_talking_from_a_page_brings_the_page_and_may_write_only_its_project_wiki(self):
        page = converse.page_arg("/companies/demo/wiki/fronts/speed", "companies/demo/wiki/fronts/speed.md", "Too slow")
        t = converse.new_thread("demo", "About this page", "Use Inter for body text.", to="ceo", talk=True, page=page)
        prompt = converse.build_prompt(t, "ceo")
        self.assertIn("Screens refresh too often.", prompt)  # the page itself
        self.assertIn("write it into the page itself", prompt)
        self.assertEqual(converse.page_wiki(t), "companies/demo/wiki")
        for bad in (("/x", "../etc/passwd", ""), ("/x", "/etc/passwd", ""), ("javascript:x", "", "")):
            with self.assertRaises(SystemExit):
                converse.page_arg(*bad)
        plain = converse.new_thread("demo", "No page", "hi", to="ceo", talk=True)
        self.assertIsNone(converse.page_wiki(plain))

    def test_unknown_project_and_paths_outside_threads_are_rejected(self):
        with self.assertRaises(SystemExit):
            converse.new_thread("../etc", "x", "y")
        with self.assertRaises(SystemExit):
            converse.thread_path(str(self.root / "companies" / "demo"))

    def test_prompt_holds_role_brief_open_fronts_and_thread_only(self):
        t = converse.new_thread("demo", "Speed", "Look at refreshes.")
        prompt = converse.take_turn(t, dry_run=True)
        self.assertIn("You are the coo.", prompt)
        self.assertIn("Why Demo exists.", prompt)
        self.assertIn("Too slow", prompt)
        self.assertNotIn("Old", prompt.split("## Open fronts")[1].split("#")[0])
        self.assertIn("Look at refreshes.", prompt)
        self.assertNotIn("Ship weekly.", prompt)  # direction is for the CEO
        self.assertIn("Ship weekly.", converse.build_prompt(t, "ceo"))

    def test_every_role_gets_the_writing_rules(self):
        t = converse.new_thread("demo", "Speed", "Look at refreshes.")
        for role in ("coo", "ceo"):
            prompt = converse.build_prompt(t, role)
            self.assertIn("skills/writing.md", prompt)
            self.assertIn("written_by: agent", prompt)

    def test_long_threads_send_first_and_last_messages(self):
        t = converse.new_thread("demo", "Long", "first")
        for i in range(8):
            converse.add_message(t, "coo" if i % 2 == 0 else "ceo", "ceo" if i % 2 == 0 else "coo", "reply", f"msg {i}")
        text = converse.thread_text(t)
        self.assertIn("first", text)
        self.assertIn("msg 7", text)
        self.assertNotIn("msg 2", text)
        self.assertIn("earlier messages omitted", text)

    def test_parse_reply_reads_header_and_falls_back_safely(self):
        r = converse.parse_reply("to: owner\nkind: decision\nsubject: Go\nthread_summary: Agreed.\n---\nDo it.", "ceo")
        self.assertEqual((r["to"], r["kind"], r["subject"], r["summary"], r["body"]),
                         ("owner", "decision", "Go", "Agreed.", "Do it."))
        r = converse.parse_reply("just prose", "coo")
        self.assertEqual((r["to"], r["kind"], r["body"]), ("ceo", "reply", "just prose"))
        r = converse.parse_reply("to: owner\nkind: report\n---\nx", "coo")
        self.assertEqual(r["to"], "ceo")  # the COO goes through the CEO
        r = converse.parse_reply("to: coo\nkind: approval\n---\nx", "coo")
        self.assertEqual((r["to"], r["kind"]), ("ceo", "reply"))  # can't address itself or approve

    def test_message_to_alex_waits_for_him_and_approval_decides(self):
        t = converse.new_thread("demo", "Go?", "Decide.")
        converse.add_message(t, "ceo", "owner", "decision", "Yes.", "Ship v1.5")
        self.assertEqual(converse.read_thread(t)[0]["status"], "awaiting-owner")
        self.assertIsNone(converse.next_role(t))
        with self.assertRaises(SystemExit):
            converse.take_turn(t)
        converse.main(["approve", str(t)])
        self.assertEqual(converse.read_thread(t)[0]["status"], "decided")

    def set_tiers(self, **tiers):
        (self.root / "holding" / "portfolio.json").write_text(json.dumps(tiers))

    def test_small_projects_skip_the_ceo_until_alex_asks_for_it(self):
        t = converse.new_thread("demo", "Package it", "Update the download page.")
        self.assertEqual(converse.read_thread(t)[0]["participants"], ["owner", "coo"])
        self.assertIn("report to the owner directly", converse.build_prompt(t, "coo"))
        self.assertEqual(converse.parse_reply("to: ceo\nkind: decision\n---\nx", "coo", converse.boss(t))["to"], "owner")
        converse.add_message(t, "coo", "owner", "decision", "Plan.", "Ship v1")
        converse.main(["approve", str(t)])
        self.assertEqual(converse.messages(t)[-1][1]["to"], "coo")  # approval goes back to whoever proposed
        converse.add_message(t, "owner", "ceo", "question", "Worth more?")
        self.assertIn("ceo", converse.read_thread(t)[0]["participants"])
        self.assertIn("isn't one of your focus projects", converse.build_prompt(t, "ceo"))

    def test_focus_projects_get_the_ceo_and_its_portfolio_view_is_sliced(self):
        other = self.root / "companies" / "tiny"
        other.mkdir()
        (other / "company.json").write_text(json.dumps({"id": "tiny", "name": "Tiny", "one_liner": "SECRET DETAIL"}))
        self.set_tiers(focus=["demo"], maintain=["tiny"])
        (self.root / "companies" / "demo" / "company.json").write_text(
            json.dumps({"id": "demo", "name": "Demo", "one_liner": "Public app"}))
        t = converse.new_thread("demo", "Grow", "Plan the launch.")
        self.assertEqual(converse.read_thread(t)[0]["participants"], ["owner", "ceo", "coo"])
        prompt = converse.build_prompt(t, "ceo")
        self.assertIn("Public app", prompt)
        self.assertIn("tiny", prompt.split("Not yours unless asked")[1])
        self.assertNotIn("SECRET DETAIL", prompt)
        self.assertIn("never to the owner directly", converse.build_prompt(t, "coo"))

    def test_ceo_consults_coos_mid_turn_and_always_answers_alex(self):
        self.set_tiers(focus=["demo"])
        t = converse.new_thread("demo", "Where next?", "What should Demo become?", to="ceo")
        self.assertIn(f"consult {t.relative_to(self.root)} <project-slug>", converse.build_prompt(t, "ceo"))
        calls = []

        def fake(prompt, role, scope, model, *rest, **kw):
            calls.append((role, scope, kw.get("consult_from")))
            if role == "coo":
                return "Two concepts.", {"engine": "claude", "model": model, "seconds": 1}
            converse.consult(t, "demo", "What does the code allow?")
            return "to: coo\nkind: question\nsubject: Two ways\nthread_summary: s\n---\nHere they are.", {"engine": "claude"}

        real = converse.run_claude
        converse.run_claude = fake
        try:
            converse.take_turn(t)
        finally:
            converse.run_claude = real
        self.assertEqual(calls, [("ceo", "demo", t), ("coo", "demo", None)])
        self.assertEqual(converse.messages(t)[-1][1]["to"], "owner")  # never handed to the COO in the thread
        meta, body = converse.split_frontmatter((t / "consults" / "001-demo.md").read_text())
        self.assertEqual((meta["feeds"], meta["status"], body.strip()), (2, "done", "Two concepts."))
        with self.assertRaises(SystemExit):
            converse.consult(t, "nope", "?")

    def test_an_answer_withdraws_or_recomputes_the_questions_it_changes(self):
        self.set_tiers(focus=["demo"])
        ask = lambda title: converse.new_thread("demo", title, "Look into it.", to="ceo")
        a, b, c, d = ask("Which camera?"), ask("Ship Swift weekly?"), ask("Pricing page copy"), ask("Logo colour")
        for t in (a, b, c, d):
            converse.add_message(t, "ceo", "owner", "question", f"Question for {t.name}?")
        converse.add_message(a, "owner", "ceo", "reply", "We restart in React Native.")
        rel = lambda t: str(t.relative_to(self.root))
        prompt = converse.build_prompt(a, "ceo")
        self.assertIn(rel(b), prompt)
        self.assertNotIn(f"`{rel(a)}`", prompt.split("# Other questions waiting on the owner")[1].split("```reconcile")[0])
        prompts = []

        def fake(prompt, role, scope, model, *rest, **kw):
            prompts.append(prompt)
            if len(prompts) == 1:
                body = (f"Going with React Native.\n\n```reconcile\n{rel(b)} | withdraw | Swift is no longer the plan\n"
                        f"{rel(c)} | redo | copy must sell the RN app\ncompanies/other/threads/x | withdraw | not offered\n```")
                return f"to: owner\nkind: decision\nsubject: RN restart\nthread_summary: s\n---\n{body}", {}
            return "to: owner\nkind: question\nsubject: New copy\nthread_summary: s\n---\nWhich line leads?", {}

        real = converse.run_claude
        converse.run_claude = fake
        try:
            converse.take_turn(a)
        finally:
            converse.run_claude = real
        self.assertEqual(converse.read_thread(b)[0]["status"], "closed")  # moot: withdrawn, not approved
        self.assertEqual(converse.read_thread(b)[0]["superseded_by"], rel(a))
        self.assertNotIn("decisions.json", [p.name for p in (self.root / "companies" / "demo").iterdir()])
        self.assertIn("copy must sell the RN app", prompts[1])  # recomputed with the reason in front of it
        self.assertEqual(converse.messages(c)[-1][2].strip(), "Which line leads?")
        self.assertEqual(converse.read_thread(c)[0]["status"], "awaiting-owner")
        self.assertEqual(converse.read_thread(d)[0]["status"], "awaiting-owner")  # untouched
        self.assertEqual([x["action"] for x in converse.read_thread(a)[0]["reconciled"]], ["withdraw", "redo"])
        # A CEO turn that isn't answering the owner can't close their questions, whatever it writes.
        converse.add_message(c, "ceo", "ceo", "report", "Thinking it over.")
        converse.run_claude = lambda *a, **k: (f"to: owner\nkind: reply\nsubject: s\nthread_summary: s\n---\nx\n\n```reconcile\n{rel(d)} | withdraw | sneaky\n```", {})
        try:
            converse.take_turn(c, "ceo")
        finally:
            converse.run_claude = real
        self.assertEqual(converse.read_thread(d)[0]["status"], "awaiting-owner")

    def test_turns_mark_the_thread_running_and_log_failures(self):
        t = converse.new_thread("demo", "Go?", "Decide.")
        seen = {}

        def fake(prompt, role, scope, model, *rest, **kw):
            seen["running"] = converse.read_thread(t)[0].get("running")
            raise SystemExit("rate limited")

        real = converse.run_claude
        converse.run_claude = fake
        try:
            with self.assertRaises(SystemExit):
                converse.take_turn(t)
        finally:
            converse.run_claude = real
        self.assertEqual(seen["running"]["role"], "coo")
        meta = converse.read_thread(t)[0]
        self.assertNotIn("running", meta)
        self.assertEqual(meta["failed"]["error"], "rate limited")
        log = (self.root / "holding" / "runs.jsonl").read_text().splitlines()
        self.assertFalse(json.loads(log[-1])["ok"])
        converse.update_thread(t, running={"pid": 999999})
        self.assertIsNone(converse.running_pid(t))  # a crashed run's marker isn't a live run

    def test_attachments_are_listed_for_agents_and_their_folders_opened(self):
        outside = Path(tempfile.mkdtemp(dir=Path.home()))
        try:
            (outside / "shot.png").write_bytes(b"png")
            (outside / "spec").mkdir()
            t = converse.new_thread("demo", "Look", "See these.", attachments=[str(outside / "shot.png"), str(outside / "spec")])
            meta = converse.messages(t)[0][1]
            self.assertEqual([a["kind"] for a in meta["attachments"]], ["image", "folder"])
            self.assertIn(f"- image #1: {(outside / 'shot.png').resolve()}", converse.thread_text(t))
            self.assertIn(f"- folder #1: {(outside / 'spec').resolve()}", converse.thread_text(t))
            self.assertEqual(converse.attachment_dirs(t), sorted({str(outside.resolve()), str((outside / "spec").resolve())}))
            with self.assertRaises(SystemExit):
                converse.attachment("/etc/hosts")  # outside the home folder
        finally:
            import shutil
            shutil.rmtree(outside)

    def test_each_attachment_leaves_a_numbered_record_line_in_the_body(self):
        import shutil
        # Uploads must be inside the home folder: run this one with the fixture repo there.
        home = tempfile.TemporaryDirectory(dir=Path.home())
        outside = Path(tempfile.mkdtemp(dir=Path.home())).resolve()
        try:
            root = Path(home.name).resolve()
            shutil.copytree(self.root, root, dirs_exist_ok=True)
            converse.ROOT = portfolio.ROOT = root
            up = root / "holding" / "uploads" / "2026-10-11"
            up.mkdir(parents=True)
            (up / "mabc1230-image.png").write_bytes(b"png")
            (up / "mabc1231-pasted-Release-notes.md").write_text("\n## Release notes [draft] for \\the week\n\nMore.")
            (up / "mabc1232-terms.pdf").write_bytes(b"%PDF")
            (up / "mabc1233-image.png").write_bytes(b"png")
            (up / "mabc1234-notes.txt").write_text("dropped, not pasted")
            far = outside / "my spec.txt"
            far.write_text("spec")
            rel = "holding/uploads/2026-10-11"

            converse.main(["chat", "holding", "--body", "Look at this.", "--typed", "Look at thsi.",
                           "--attach", str(up / "mabc1230-image.png"), str(up / "mabc1231-pasted-Release-notes.md"),
                           str(up / "mabc1232-terms.pdf")])
            t = root / "holding" / "threads" / "chat"
            _, m, body = converse.messages(t)[0]
            self.assertEqual(body, "Look at this.\n\n"
                                   f"[image #1]({rel}/mabc1230-image.png)\n"
                                   f"[pasted #1: Release notes draft for the week]({rel}/mabc1231-pasted-Release-notes.md)\n"
                                   f"[file #1: terms.pdf]({rel}/mabc1232-terms.pdf)")
            self.assertEqual(m["typed"], "Look at thsi.")  # their words only, never the record lines
            self.assertEqual([(a["kind"], a["n"]) for a in m["attachments"]], [("image", 1), ("pasted", 1), ("file", 1)])

            # Numbers carry on across the thread; an attachment alone needs no words; outside the repo stays absolute.
            converse.main(["chat", "holding", "--body", " ", "--attach", str(up / "mabc1233-image.png"), str(far),
                           str(up / "mabc1234-notes.txt")])
            _, m2, body2 = converse.messages(t)[1]
            self.assertEqual(body2, f"[image #2]({rel}/mabc1233-image.png)\n[file #2: my spec.txt](<{far}>)\n"
                                    f"[file #3: notes.txt]({rel}/mabc1234-notes.txt)")
            self.assertNotIn("typed", m2)
            prompt = converse.thread_text(t)
            self.assertIn(f"- image #2: {rel}/mabc1233-image.png", prompt)  # the agent sees the owner's numbers
            self.assertIn(f"- pasted #1: {rel}/mabc1231-pasted-Release-notes.md", prompt)
            self.assertIn(f"- file #2: {far}", prompt)

            # `new` and `post` record them the same way.
            converse.main(["new", "holding", "Shots", "--body", "First.", "--attach", str(up / "mabc1230-image.png")])
            nt = next(p for p in (root / "holding" / "threads").iterdir() if p.name != "chat")
            converse.main(["post", str(nt), "--as", "owner", "--to", "ceo", "--body", "",
                           "--attach", str(up / "mabc1233-image.png")])
            self.assertEqual([b for _, _, b in converse.messages(nt)],
                             [f"First.\n\n[image #1]({rel}/mabc1230-image.png)", f"[image #2]({rel}/mabc1233-image.png)"])
            with self.assertRaises(SystemExit):
                converse.main(["post", str(nt), "--as", "owner", "--to", "ceo", "--body", " "])  # no words, nothing attached
        finally:
            converse.ROOT = portfolio.ROOT = self.root
            home.cleanup()
            shutil.rmtree(outside)

    def test_alex_picks_the_model_per_role_and_helpers_stay_within_the_overseers_tools(self):
        t = converse.new_thread("demo", "Go?", "Decide.")
        converse.main(["post", str(t), "--as", "owner", "--to", "coo", "--body", "Dig in.", "--model", "opus"])
        seen = {}

        def fake(prompt, role, scope, model, extra=(), helpers=True, writable=(), **kw):
            seen.update(model=model, helpers=helpers, prompt=prompt)
            return "to: ceo\nkind: report\n---\nDone.", {"engine": "claude"}

        real = converse.run_claude
        converse.run_claude = fake
        try:
            converse.take_turn(t)
        finally:
            converse.run_claude = real
        self.assertEqual((seen["model"], seen["helpers"]), ("opus", True))
        self.assertIn("`scout`", seen["prompt"])
        ceo = converse.helper_agents(converse.TOOLS["ceo"])
        self.assertNotIn("Bash(git log:*)", ceo["scout"]["tools"])  # the CEO's scout can't do more than the CEO
        self.assertIn("Bash(git log:*)", converse.helper_agents(converse.TOOLS["coo"])["scout"]["tools"])
        converse.set_models(t, "coo", None, no_helpers=True)
        self.assertIs(converse.read_thread(t)[0]["helpers"], False)

    def test_subscription_env_drops_api_key(self):
        import os
        os.environ["ANTHROPIC_API_KEY"] = "test"
        try:
            self.assertNotIn("ANTHROPIC_API_KEY", converse.subscription_env())
        finally:
            del os.environ["ANTHROPIC_API_KEY"]

class Options(unittest.TestCase):
    BODY = """Ship from main.

```release
verdict: push
```

```options
ask: Ship from main or restart in React Native?
- A | Restart in React Native | time: 3-5 months | complexity: high | growth: medium | costs: no releases this quarter
B* | Ship 1.3 from main weekly | time: 1 week | complexity: low | growth: medium | costs: no Android
revisit: real Android demand
```"""

    def test_card(self):
        card = converse.options_card(self.BODY)
        self.assertEqual(card["ask"], "Ship from main or restart in React Native?")
        self.assertEqual([o["key"] for o in card["options"]], ["A", "B"])
        self.assertEqual([o["recommended"] for o in card["options"]], [False, True])
        self.assertEqual(card["options"][0]["time"], "3-5 months")
        self.assertEqual(card["options"][1]["costs"], "no Android")
        self.assertEqual(card["revisit"], "real Android demand")

    def test_missing_or_empty(self):
        self.assertIsNone(converse.options_card("No block here."))
        self.assertIsNone(converse.options_card("```options\nask: Anything?\n```"))
        card = converse.options_card("```options\nA | Do it | time: 1 week\n```")
        self.assertTrue(card["options"][0]["recommended"])  # first option stands in when none is marked

    def test_prompt_asks_for_block(self):
        self.assertIn("```options", converse.OPTIONS_RULE)

class Talk(Threads):
    def test_talk_threads_span_projects_and_skip_the_desk(self):
        other = self.root / "companies" / "other"
        other.mkdir()
        (other / "company.json").write_text(json.dumps({"id": "other", "name": "Other", "repos": []}))
        t = converse.new_thread("demo", "Ideas", "What if it did X?", talk=True, projects=["other"])
        self.assertTrue(converse.is_talk(t))
        self.assertEqual(converse.about(t), ["demo", "other"])
        self.assertEqual(converse.boss(t), "owner")
        prompt = converse.build_prompt(t, "coo")
        self.assertIn("talk thread", prompt)
        self.assertIn("# Also about", prompt)
        self.assertIn("companies/other/wiki/ideas/", prompt)
        converse.add_message(t, "coo", "owner", "reply", "Here's a thought.")
        self.assertEqual(converse.read_thread(t)[0]["status"], "talking")
        self.assertEqual(converse.desk(), [])
        converse.add_message(t, "owner", "coo", "reply", "Let's decide.")
        converse.add_message(t, "coo", "owner", "decision", "Do X.\n\n```options\nA* | Do X | time: 1 week\n```")
        self.assertEqual(converse.read_thread(t)[0]["status"], "awaiting-owner")
        self.assertEqual(len(converse.desk()), 1)

    def test_chat_is_one_thread_per_project_and_reads_the_page_of_the_latest_message(self):
        wiki = self.root / "companies" / "demo" / "wiki"
        (wiki / "a.md").write_text("---\ntitle: Page A\n---\n\nPAGE_A_ONLY\n")
        (wiki / "b.md").write_text("---\ntitle: Page B\n---\n\nPAGE_B_ONLY\n")
        page = ["--page-url", "/companies/demo/wiki/a", "--page-file", "companies/demo/wiki/a.md", "--page-title", "Page A"]
        converse.main(["chat", "demo", "--body", "Tighten this.", *page])
        t = self.root / "companies" / "demo" / "threads" / "chat"
        self.assertTrue(converse.is_chat(t) and converse.is_talk(t))
        self.assertIn("PAGE_A_ONLY", converse.build_prompt(t, "ceo"))
        tools = converse.TOOLS_DIR
        self.assertEqual(converse.chat_commands(t), (f"python3 {tools}/converse.py spawn companies/demo/threads/chat",
                                                     f"python3 {tools}/agenda.py --by companies/demo/threads/chat",
                                                     f"python3 {tools}/converse.py board companies/demo/threads/chat"))
        # Every chat reads and writes the calendar through agenda.py, in its own name.
        self.assertIn(f"python3 {tools}/agenda.py --by companies/demo/threads/chat <command>", converse.build_prompt(t, "ceo"))
        converse.add_message(t, "ceo", "owner", "reply", "Done: `companies/demo/wiki/a.md`")
        self.assertEqual(converse.read_thread(t)[0]["status"], "talking")
        # The same thread again, from another page: the agent gets that page, not the first one.
        same = converse.chat("demo", "Now this one.", converse.page_arg("/companies/demo/wiki/b", "companies/demo/wiki/b.md", "Page B"))
        self.assertEqual(same, t)
        prompt = converse.build_prompt(t, "ceo")
        self.assertIn("PAGE_B_ONLY", prompt)
        self.assertNotIn("PAGE_A_ONLY", prompt)
        self.assertIn("sent from Page A (/companies/demo/wiki/a)", prompt)
        self.assertIn("one running conversation", prompt)
        self.assertEqual(converse.page_wiki(t), "companies/demo/wiki")
        # Page turned off for one message: no page at all, not an older one.
        converse.add_message(t, "ceo", "owner", "reply", "Ok.")
        converse.chat("demo", "General question.")
        self.assertNotIn("# The page:", converse.build_prompt(t, "ceo"))
        self.assertEqual(len(converse.messages(t)), 5)
        # post takes the page per message too.
        converse.main(["post", str(t), "--as", "owner", "--to", "ceo", "--body", "And here.", *page])
        self.assertEqual(converse.messages(t)[-1][1]["page"]["url"], "/companies/demo/wiki/a")
        converse.update_thread(t, running={"pid": os.getpid()})
        with self.assertRaises(SystemExit):
            converse.chat("demo", "Too soon.")
        # A decision never lands in the chat (it would sit on the desk forever): it comes back as a reply.
        converse.update_thread(t, clear=("running",))
        real = converse.run_claude
        converse.run_claude = lambda *a, **k: ("to: owner\nkind: decision\nsubject: X\nthread_summary: s\n---\nDo X.", {})
        try:
            converse.take_turn(t)
        finally:
            converse.run_claude = real
        self.assertEqual(converse.messages(t)[-1][1]["kind"], "reply")
        self.assertEqual(converse.read_thread(t)[0]["status"], "talking")
        self.assertIn(f"python3 {converse.TOOLS_DIR}/converse.py spawn companies/demo/threads/chat",
                      converse.build_prompt(t, "ceo"))

    def test_chat_spawns_threads_as_the_ceo_and_takes_no_other_flags(self):
        converse.chat("demo", "Look into shared rolls properly.")
        chat = self.root / "companies" / "demo" / "threads" / "chat"
        converse.main(["spawn", str(chat), "Shared rolls", "--body", 'He asked: "Look into shared rolls properly."'])
        [t] = [p.parent for p in (self.root / "companies" / "demo" / "threads").glob("*-shared-rolls/thread.md")]
        [(_, m, _)] = converse.messages(t)
        self.assertEqual((m["from"], m["to"], m["kind"]), ("ceo", "coo", "directive"))
        self.assertEqual(converse.read_thread(t)[0]["spawned_from"], "companies/demo/threads/chat")
        for extra in (["--from", "owner"], ["--attach", "/etc/hosts"], ["--to", "ceo"], ["--model", "opus"]):
            with self.assertRaises(SystemExit):
                converse.main(["spawn", str(chat), "Again", "--body", "x", *extra])
        with self.assertRaises(SystemExit):  # only from a chat thread
            converse.main(["spawn", str(t), "Again", "--body", "x"])
        with self.assertRaises(SystemExit):
            converse.main(["board", str(chat), "Ship it", "--run"])

    def _turn_grants(self, thread):
        """Take one turn with a fake engine; return (writable, prompt) the engine was given."""
        seen = {}

        def fake(prompt, role, scope, model, extra=(), helpers=True, writable=(), **kw):
            seen.update(writable=writable, prompt=prompt)
            return "to: owner\nkind: reply\n---\nOk.", {"engine": "claude"}

        real = converse.run_claude
        converse.run_claude = fake
        try:
            converse.take_turn(thread)
        finally:
            converse.run_claude = real
        return seen["writable"], seen["prompt"]

    def test_the_parent_company_chat_may_write_its_wiki_and_the_vision_from_that_page(self):
        holding = self.root / "holding"
        (holding / "wiki" / "fronts").mkdir(parents=True)
        (holding / "wiki" / "index.md").write_text("---\ntitle: Parent company\n---\n\nHOLDING_STORY\n")
        (holding / "wiki" / "fronts" / "entity.md").write_text("---\ntitle: Entity\nkind: front\n---\n\nENTITY\n")
        (holding / "vision.md").write_text("---\ntitle: Vision\n---\n\nVISION_TEXT\n")
        (holding / "setup.json").write_text("{}")
        chat = holding / "threads" / "chat"
        # A front's page: the holding wiki is writable, nothing else.
        converse.chat("holding", "Add the state.", converse.page_arg("/company/entity", "holding/wiki/fronts/entity.md", "Entity"))
        self.assertEqual(converse.page_wiki(chat), "holding/wiki")
        self.assertEqual(converse.page_files(chat), ())
        writable, prompt = self._turn_grants(chat)
        self.assertIn("holding/wiki", writable)
        self.assertIn("holding/wiki/ideas", writable)
        self.assertNotIn("holding/vision.md", writable)
        self.assertIn("you may edit anything under `holding/wiki/`", prompt)
        self.assertNotIn("you can't edit", prompt)
        # The vision page: Edit on that one file, as a single-file grant.
        converse.chat("holding", "Tighten this.", converse.page_arg("/company/vision", "holding/vision.md", "Vision"))
        writable, prompt = self._turn_grants(chat)
        self.assertIn("holding/vision.md", writable)
        self.assertIn("you may edit `holding/vision.md`", prompt)
        # The setup checklist: no grant on setup.json; the CEO says the change and the owner makes it.
        converse.chat("holding", "Add a step.", converse.page_arg("/company/setup", "holding/setup.json", "Setup"))
        writable, prompt = self._turn_grants(chat)
        self.assertFalse(any("setup.json" in w or "money.json" in w for w in writable))
        self.assertIn("you can't edit `holding/setup.json`", prompt)
        seen = []

        class Done:
            stdout = json.dumps({"result": "ok"})
            stderr = ""
            returncode = 0

        real = converse.subprocess.run
        converse.subprocess.run = lambda cmd, **kw: seen.append(cmd) or Done()
        try:
            converse.run_claude("p", "ceo", "holding", "opus", writable=("holding/wiki", "holding/vision.md"))
        finally:
            converse.subprocess.run = real
        self.assertIn("Edit(./holding/vision.md)", seen[0])
        self.assertNotIn("Write(./holding/vision.md)", seen[0])
        self.assertNotIn("Edit(./holding/vision.md/**)", seen[0])
        self.assertIn("Write(./holding/wiki/**)", seen[0])
        # A project's page thread is unchanged: its own wiki only.
        page = converse.page_arg("/companies/demo/wiki/fronts/speed", "companies/demo/wiki/fronts/speed.md", "Too slow")
        t = converse.new_thread("demo", "About this page", "Hi.", to="ceo", talk=True, page=page)
        self.assertEqual((converse.page_wiki(t), converse.page_files(t)), ("companies/demo/wiki", ()))

    def test_holding_ceo_runs_may_write_holding_ideas_and_project_runs_stay_as_they_were(self):
        t = converse.new_thread("holding", "Naming", "Bring candidates.", to="ceo")
        writable, prompt = self._turn_grants(t)
        self.assertEqual(writable, ("holding/wiki/ideas", "discovery/ideas"))
        self.assertIn("holding/wiki/ideas/", prompt)
        p = converse.new_thread("demo", "Go?", "Decide.", to="ceo")
        writable, _ = self._turn_grants(p)
        self.assertEqual(writable, ())

    def test_a_holding_spawn_is_the_ceos_own_brief_and_its_turn_starts(self):
        started = []
        real = converse.start_run
        converse.start_run = started.append
        try:
            converse.chat("holding", "Name the company.")
            chat = self.root / "holding" / "threads" / "chat"
            converse.main(["spawn", str(chat), "Parent company name", "--body", "Bring candidates."])
            [t] = [p for p in (self.root / "holding" / "threads").iterdir() if p.name != "chat"]
            [(_, m, _)] = converse.messages(t)
            self.assertEqual((m["from"], m["to"], m["kind"]), ("ceo", "ceo", "directive"))  # never the owner's words
            meta = converse.read_thread(t)[0]
            self.assertEqual((meta["status"], meta["spawned_from"]), ("open", "holding/threads/chat"))
            self.assertEqual(converse.next_role(t), "ceo")
            self.assertEqual(started, [t])
            self.assertIn("your own brief", converse.build_prompt(t, "ceo"))
            # The CEO's answer goes to the owner.
            self._turn_grants(t)
            self.assertEqual(converse.messages(t)[-1][1]["to"], "owner")
            self.assertEqual(converse.read_thread(t)[0]["status"], "awaiting-owner")
            # A project's spawn is unchanged: a directive to the COO, nothing started.
            converse.chat("demo", "Look into it.")
            converse.main(["spawn", str(self.root / "companies" / "demo" / "threads" / "chat"), "Look", "--body", "b"])
            self.assertEqual(len(started), 1)
        finally:
            converse.start_run = real

    def test_chat_grants_cannot_be_stretched(self):
        converse.chat("demo", "Hi.")
        chat = "companies/demo/threads/chat"
        threads = self.root / "companies" / "demo" / "threads"
        # (b) argparse: flag-like titles, extra positionals after --, and unknown flags are refused; a repeated
        # --body only changes the body, never the sender.
        for argv in (["spawn", chat, "-x", "--body", "b"], ["spawn", chat, "T", "--body", "b", "--", "extra"],
                     ["spawn", chat, "T", "--body", "b", "--sender", "owner"], ["spawn", chat, "--body", "b"]):
            with self.assertRaises(SystemExit):
                converse.main(argv)
        converse.main(["spawn", chat, "Twice", "--body=one", "--body=two"])
        [m] = [m for p in threads.glob("*-twice") for _, m, _ in converse.messages(p)]
        self.assertEqual(m["from"], "ceo")
        # (c) a title can't name a folder outside threads/.
        for title in ("../../../etc", "a/../../b", "///", ".."):
            converse.main(["spawn", chat, title, "--body", "b"])
        for d in threads.iterdir():
            self.assertEqual(d.parent, threads)
            self.assertRegex(d.name, r"^(chat|\d{4}-\d\d-\d\d-[a-z0-9-]+)$")
        with self.assertRaises(SystemExit):
            converse.main(["spawn", chat, "  ", "--body", "b"])
        # (e) a thread.md the chat agent writes into its wiki, marked chat, is not a thread at all.
        fake = self.root / "companies" / "demo" / "wiki" / "threads" / "chat"
        fake.mkdir(parents=True)
        (fake / "thread.md").write_text('---\nmode: "chat"\n---\n')
        with self.assertRaises(SystemExit):
            converse.main(["spawn", str(fake), "T", "--body", "b"])
        # A chat agent's run is pinned to its own chat: another project's chat (or a ../ path to it) is refused.
        other = self.root / "companies" / "other"
        other.mkdir()
        (other / "company.json").write_text(json.dumps({"id": "other", "name": "Other", "repos": []}))
        converse.chat("other", "Hi.")
        os.environ[converse.CHAT_PIN] = chat
        try:
            for target in ("companies/other/threads/chat", f"{chat}/../../../other/threads/chat"):
                with self.assertRaises(SystemExit):
                    converse.main(["spawn", target, "T", "--body", "b"])
            converse.main(["spawn", chat, "Allowed", "--body", "b"])
        finally:
            os.environ.pop(converse.CHAT_PIN)

    def test_runs_get_chat_grants_only_from_the_chat_turn(self):
        # (a) granted commands use an absolute script path; (d) a run started from a chat command (board's planning
        # COO) gets no chat grants and doesn't inherit the pin.
        seen = []

        class Done:
            stdout = json.dumps({"result": "ok"})
            stderr = ""
            returncode = 0

        real = converse.subprocess.run
        converse.subprocess.run = lambda cmd, **kw: seen.append((cmd, kw["env"])) or Done()
        os.environ[converse.CHAT_PIN] = "companies/demo/threads/chat"
        try:
            converse.run_claude("p", "coo", "demo", "sonnet")
            converse.run_claude("p", "ceo", "demo", "opus", commands=("python3 /abs/converse.py spawn x",), pin="x")
        finally:
            converse.subprocess.run = real
            os.environ.pop(converse.CHAT_PIN)
        (plain, plain_env), (chat, chat_env) = seen
        self.assertFalse(any("spawn" in c or "board" in c for c in plain))
        self.assertNotIn(converse.CHAT_PIN, plain_env)
        self.assertIn("Bash(python3 /abs/converse.py spawn x :*)", chat)
        self.assertEqual(chat_env[converse.CHAT_PIN], "x")

    def test_approval_is_recorded_once_in_decisions_json(self):
        t = converse.new_thread("demo", "Go?", "Should we?")
        converse.add_message(t, "coo", "owner", "decision",
                             "Ship it.\n\n```options\nask: Ship?\nA* | Ship | time: 1 week\nB | Wait | time: 1 month\nrevisit: no users\n```",
                             subject="Ship it")
        converse.main(["approve", str(t), "--note", "Yes."])
        log = json.loads((self.root / "companies" / "demo" / "decisions.json").read_text())
        self.assertEqual(len(log), 1)
        self.assertEqual(log[0]["decision"], "Ship it")
        self.assertEqual(log[0]["alternatives"], ["B: Wait"])
        self.assertEqual(log[0]["revisit"], "no users")
        self.assertEqual(log[0]["note"], "Yes.")
        self.assertIsNone(converse.record_decision(t))


class Models(Threads):
    def test_fable_is_a_model(self):
        self.assertIn("fable", converse.MODELS)

    def test_default_model_falls_back_without_models_json(self):
        self.assertEqual(converse.default_model("ceo"), converse.DEFAULT_MODEL["ceo"])
        self.assertEqual(converse.default_model("coo"), converse.DEFAULT_MODEL["coo"])

    def test_models_json_overrides_per_role_and_ignores_unknown_values(self):
        (self.root / "holding" / "models.json").write_text(json.dumps({"ceo": "fable", "coo": "gpt"}))
        self.assertEqual(converse.default_model("ceo"), "fable")
        self.assertEqual(converse.default_model("coo"), converse.DEFAULT_MODEL["coo"])
        (self.root / "holding" / "models.json").write_text("not json")
        self.assertEqual(converse.default_model("ceo"), converse.DEFAULT_MODEL["ceo"])

    def test_chat_model_sticks_per_role(self):
        converse.main(["chat", "demo", "--body", "Hello", "--model", "fable", "--coo-model", "haiku"])
        meta = converse.read_thread(self.root / "companies" / "demo" / "threads" / "chat")[0]
        self.assertEqual(meta["models"], {"ceo": "fable", "coo": "haiku"})


SESSION_LIMIT = "You've hit your session limit · resets 3:30pm (America/New_York)"  # holding/runs.jsonl, 2026-10-11


class Limits(unittest.TestCase):
    def setUp(self):
        from zoneinfo import ZoneInfo
        self.ny = ZoneInfo("America/New_York")
        self.now = converse.dt.datetime(2026, 10, 11, 12, 37, tzinfo=self.ny)

    def test_limit_errors_are_told_from_other_errors(self):
        for text in (SESSION_LIMIT, "Claude AI usage limit reached|1760200000", "5-hour limit reached ∙ resets 3pm",
                     "You've reached your weekly limit · resets Oct 14, 9am", "API Error: 429 rate limited"):
            self.assertTrue(converse.is_limit(text), text)
        for text in ("", None, "API Error: 500 Internal server error", "CameraApp: file not found",
                     "Context limit reached", "Prompt is too long", "Budget limit reached ($1.00 of $1.00)"):
            self.assertFalse(converse.is_limit(text), text)

    def test_reset_time_from_the_clock_and_zone(self):
        reset = converse.reset_time(SESSION_LIMIT, self.now)
        self.assertEqual(reset, converse.dt.datetime(2026, 10, 11, 15, 30, tzinfo=self.ny))
        at = converse.retry_time(SESSION_LIMIT, self.now)
        self.assertEqual(at, reset + converse.dt.timedelta(minutes=1))
        self.assertEqual(at.astimezone(self.ny).isoformat(timespec="seconds"), "2026-10-11T15:31:00-04:00")
        later = self.now.replace(hour=16)  # past 3:30pm: tomorrow's 3:30pm
        self.assertEqual(converse.reset_time(SESSION_LIMIT, later), converse.dt.datetime(2026, 10, 12, 15, 30, tzinfo=self.ny))
        self.assertEqual(converse.reset_time("limit · resets at 9am (UTC)", self.now).isoformat(), "2026-10-12T09:00:00+00:00")
        self.assertEqual(converse.reset_time("weekly limit · resets Oct 14, 9:15am (America/New_York)", self.now),
                         converse.dt.datetime(2026, 10, 14, 9, 15, tzinfo=self.ny))

    def test_reset_time_in_other_forms(self):
        self.assertEqual(converse.reset_time("usage limit · resets in 2h 15m", self.now),
                         self.now + converse.dt.timedelta(hours=2, minutes=15))
        self.assertEqual(converse.reset_time("limit reached, resets in 45 minutes", self.now),
                         self.now + converse.dt.timedelta(minutes=45))
        self.assertEqual(converse.reset_time("spend limit reached (daily; resets 2026-10-12 00:00 UTC)", self.now).isoformat(),
                         "2026-10-12T00:00:00+00:00")
        self.assertEqual(converse.reset_time("Claude AI usage limit reached|1760200000", self.now).timestamp(), 1760200000)

    def test_unknown_reset_time_retries_in_thirty_minutes(self):
        for text in ("Usage limit reached", "usage limit reached · resets soon"):
            self.assertIsNone(converse.reset_time(text, self.now))
            self.assertEqual(converse.retry_time(text, self.now), self.now + converse.dt.timedelta(minutes=30))
        # a reset that already passed doesn't mean "now": wait the same 30 minutes
        self.assertEqual(converse.retry_time("limit · resets 2026-10-11 09:00 UTC", self.now),
                         self.now + converse.dt.timedelta(minutes=30))


class Retries(Threads):
    """A run that hits the usage limit waits and is retried; the real `claude` is never called (a stubbed run)."""

    def setUp(self):
        super().setUp()
        self.started = []
        self.real_waiter, self.real_run = converse.start_waiter, converse.subprocess.run
        converse.start_waiter = lambda: self.started.append(True)

    def tearDown(self):
        converse.start_waiter, converse.subprocess.run = self.real_waiter, self.real_run
        super().tearDown()

    def stub(self, result: str, is_error: bool = False):
        out = json.dumps({"type": "result", "is_error": is_error, "result": result, "num_turns": 1, "duration_ms": 1000})
        converse.subprocess.run = lambda *a, **kw: converse.subprocess.CompletedProcess(a, 0, stdout=out, stderr="")

    def test_queue_adds_requeues_and_removes_one_entry_per_thread(self):
        first = converse.queue_retry({"thread": "companies/demo/threads/a", "role": "coo", "model": "sonnet",
                                      "engine": "claude", "retry_at": "2026-10-11T15:31:00-04:00"})
        self.assertEqual((first["attempts"], first["role"]), (1, "coo"))
        again = converse.queue_retry({"thread": "companies/demo/threads/a", "role": "coo", "model": "sonnet",
                                      "engine": "claude", "retry_at": "2026-10-11T20:31:00-04:00"})
        converse.queue_retry({"thread": "companies/demo/builds/b", "brief": "02", "role": "coder", "retry_at": "2026-10-11T16:00:00-04:00"})
        items = converse.read_retries()
        self.assertEqual(len(items), 2)
        self.assertEqual((again["attempts"], again["queued"], again["retry_at"]), (2, first["queued"], "2026-10-11T20:31:00-04:00"))
        self.assertEqual(set(items[0]) - {"brief"}, {"thread", "role", "model", "engine", "retry_at", "queued", "attempts"})
        converse.drop_retry("companies/demo/threads/a")
        self.assertEqual([(e["thread"], e["brief"]) for e in converse.read_retries()], [("companies/demo/builds/b", "02")])
        converse.drop_retry("companies/demo/builds/b", "01")  # another subtask of the same build: untouched
        self.assertEqual(len(converse.read_retries()), 1)

    def test_a_limit_queues_the_turn_and_retry_finishes_it(self):
        t = converse.new_thread("demo", "Go?", "Decide.")
        self.stub(SESSION_LIMIT, is_error=True)
        self.assertIsNone(converse.take_turn(t))
        meta = converse.read_thread(t)[0]
        self.assertNotIn("running", meta)
        self.assertNotIn("failed", meta)
        self.assertEqual((meta["waiting"]["reason"], meta["waiting"]["role"], meta["waiting"]["message"]), ("limit", "coo", SESSION_LIMIT))
        from zoneinfo import ZoneInfo
        at = converse.dt.datetime.fromisoformat(meta["waiting"]["retry_at"]).astimezone(ZoneInfo("America/New_York"))
        self.assertEqual((at.hour, at.minute), (15, 31))
        self.assertEqual(len(converse.messages(t)), 1)  # no error message posted into the thread
        line = json.loads((self.root / "holding" / "runs.jsonl").read_text().splitlines()[-1])
        self.assertEqual((line["ok"], line["limit"], line["retry_at"]), (False, True, meta["waiting"]["retry_at"]))
        [entry] = converse.read_retries()
        self.assertEqual((entry["thread"], entry["role"], entry["model"], entry["attempts"]), (str(t.relative_to(self.root)), "coo", "sonnet", 1))
        self.assertEqual(self.started, [True])  # the waiter is started

        self.assertEqual(converse.retry(), [])  # not due yet
        converse.retry(str(t))  # Retry now: the limit is still there, so it's queued again with a new time
        self.assertEqual(converse.read_retries()[0]["attempts"], 2)

        self.stub("---\nkind: report\nto: owner\nsubject: Viable\n---\n\nYes, viable.")
        self.assertEqual(converse.retry(str(t)), [(str(t.relative_to(self.root)), "done")])
        self.assertEqual(converse.read_retries(), [])
        meta = converse.read_thread(t)[0]
        self.assertNotIn("waiting", meta)
        self.assertEqual(converse.messages(t)[-1][2], "Yes, viable.")

    def test_due_entries_run_and_answered_threads_are_dropped(self):
        t = converse.new_thread("demo", "Go?", "Decide.")
        rel = str(t.relative_to(self.root))
        converse.queue_retry({"thread": rel, "role": "coo", "model": "haiku", "retry_at": "2020-01-01T00:00:00+00:00"})
        seen = []

        def run(cmd, *a, **kw):
            seen.append(cmd[cmd.index("--model") + 1])
            return converse.subprocess.CompletedProcess(cmd, 0, stdout=json.dumps(
                {"is_error": False, "result": "---\nkind: report\nto: owner\n---\n\nDone."}), stderr="")
        converse.subprocess.run = run
        self.assertEqual(converse.retry(), [(rel, "done")])
        self.assertEqual(seen, ["haiku"])  # the queued turn's own model
        converse.queue_retry({"thread": rel, "role": "coo", "retry_at": "2020-01-01T00:00:00+00:00"})
        self.assertEqual(converse.retry(), [(rel, "dropped")])  # the COO already answered the owner: nothing to run
        self.assertEqual(converse.read_retries(), [])

    def test_chat_messages_are_kept_and_answered_after_the_limit(self):
        chat = converse.chat("demo", "What's next?")
        self.stub(SESSION_LIMIT, is_error=True)
        self.assertIsNone(converse.take_turn(chat))
        self.assertEqual([m["from"] for _, m, _ in converse.messages(chat)], ["owner"])
        self.stub("Ship the export first.")
        converse.retry(str(chat))
        self.assertEqual([m["from"] for _, m, _ in converse.messages(chat)], ["owner", "ceo"])

    def test_other_errors_still_fail(self):
        t = converse.new_thread("demo", "Go?", "Decide.")
        self.stub("API Error: 500 Internal server error", is_error=True)
        with self.assertRaises(SystemExit) as caught:
            converse.take_turn(t)
        self.assertNotIsInstance(caught.exception, converse.LimitReached)
        meta = converse.read_thread(t)[0]
        self.assertIn("500", meta["failed"]["error"])
        self.assertNotIn("waiting", meta)
        self.assertEqual((converse.read_retries(), self.started), ([], []))

    def test_one_waiter_at_a_time_and_it_leaves_when_the_queue_is_empty(self):
        import fcntl
        import io
        from contextlib import redirect_stdout
        (self.root / "holding" / "retries.pid").write_text("999999")  # stale: not running
        self.assertIsNone(converse.waiter_pid())
        with open(self.root / "holding" / "retries.pid", "a+") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            out = io.StringIO()
            with redirect_stdout(out):
                converse.wait_and_retry()
            self.assertIn("already running", out.getvalue())
        converse.wait_and_retry()  # nothing queued: returns at once
        self.assertEqual((self.root / "holding" / "retries.pid").read_text(), "")


class Fanout(Threads):
    def test_custom_roles_and_per_file_data_override(self):
        (self.root / "agents" / "x.md").write_text('---\nmodel: haiku\nmax_turns: 7\ntools:\n  - Read\n  - Glob\n---\nCustom investigator.')
        self.assertIn("x", converse.agent_roles())
        self.assertEqual(converse.role_spec("x"), {"model": "haiku", "max_turns": 7, "tools": ["Read", "Glob"], "writes": []})
        (self.root / "agents" / "y.md").write_text('---\nwrites: [wiki/research, ../escape]\n---\nWriter.')
        self.assertEqual(converse.role_spec("y")["writes"], ["wiki/research"])
        self.assertEqual(converse.default_model("x"), "haiku")
        self.assertEqual(converse.role_files()["ceo"], self.root / "agents" / "ceo.md")
        self.assertIn("research", converse.agent_roles())  # shipped role survives partial overrides
        self.assertEqual(converse.role_spec("research")["tools"], ["Read", "Grep", "Glob", "WebSearch", "WebFetch"])
        t = converse.new_thread("demo", "Custom", "Find it", to="x")
        self.assertEqual(converse.next_role(t), "x")
        self.assertIn("Custom investigator", converse.take_turn(t, dry_run=True))
        with patch.object(converse.subprocess, "run", return_value=converse.subprocess.CompletedProcess([], 0,
                          stdout=json.dumps({"result": "Found it."}), stderr="")) as run:
            converse.take_turn(t, "x")
            self.assertIn("7", run.call_args.args[0])
        converse.main(["post", str(t), "--as", "x", "--to", "research", "--body", "Continue"])
        self.assertEqual(converse.next_role(t), "research")

    def test_concurrent_lanes_stream_state_posts_and_summary(self):
        import io
        import threading
        other = self.root / "companies" / "other"
        other.mkdir()
        repo = self.root / "local-code"
        repo.mkdir()
        (other / "company.json").write_text(json.dumps({"repos": [{"path": str(repo)}]}))
        t = converse.new_thread("holding", "Compare", "Compare projects")
        converse.add_message(t, "ceo", "owner", "reply", "Investigate both")
        barrier = threading.Barrier(2)
        seen = []
        transitions = []
        real_write = converse.write_lane
        def write(path, state):
            transitions.append((state["slug"], state["status"]))
            real_write(path, state)
        class Fake:
            returncode = 0
            def __init__(self, cmd, **kw):
                seen.append(kw["cwd"])
                barrier.wait(timeout=3)  # sequential subprocess creation fails here
                self.stdout = io.StringIO(json.dumps({"type": "assistant", "message": {"content": [
                    {"type": "tool_use", "name": "Read", "input": {"file_path": "sync/merge.ts"}}]}}) + "\n" +
                    json.dumps({"type": "result", "result": "Viable. Read sync/merge.ts."}) + "\n")
            def wait(self): return 0
            def kill(self): pass
        summaries = []
        def summary(thread, role, **kw):
            states = [json.loads(p.read_text()) for p in (t / "lanes").glob("*.json")]
            self.assertTrue(all(s["status"] == "done" for s in states))
            summaries.append(role)
        with patch.object(converse.subprocess, "Popen", Fake), patch.object(converse, "write_lane", write), patch.object(converse, "take_turn", summary):
            states = converse.fanout(t, ["demo", "other"], "Check sync")
        self.assertEqual(set(seen), {self.root, repo})
        self.assertEqual(summaries, ["ceo"])
        for slug in ("demo", "other"):
            self.assertEqual([status for s, status in transitions if s == slug], ["queued", "running", "running", "done"])
        self.assertEqual(len([m for _, m, _ in converse.messages(t) if m.get("lane")]), 2)
        self.assertTrue(all(s["steps"] == ["Read sync/merge.ts"] for s in states))
        self.assertIn("No local repo", converse.fanout(t, ["demo"], dry_run=True)[0]["prompt"])

    def test_failure_and_limit_do_not_block_other_lanes_and_retry_summarizes_once(self):
        other = self.root / "companies" / "other"
        other.mkdir()
        (other / "company.json").write_text('{"repos": []}')
        t = converse.new_thread("holding", "Compare", "Compare projects")
        def engine(prompt, *args):
            if "Project: demo." in prompt:
                raise converse.LimitReached("usage limit reached", converse.retry_time("limit"))
            raise RuntimeError("engine crashed")
        with patch.object(converse, "lane_engine", engine), patch.object(converse, "start_waiter"), patch.object(converse, "take_turn") as summary:
            states = converse.fanout(t, ["demo", "other"])
            self.assertEqual({s["status"] for s in states}, {"limited", "failed"})
            summary.assert_not_called()
        [entry] = converse.read_retries()
        self.assertEqual(entry["brief"], "lane:demo")
        with patch.object(converse, "lane_engine", return_value=("Recovered.", {})), patch.object(converse, "take_turn") as summary:
            self.assertEqual(converse.retry_entry(entry), "done")
            summary.assert_called_once_with(t, "ceo", engine="claude")
        self.assertEqual(converse.read_retries(), [])

    def test_codex_lanes_are_read_only_and_failure_still_summarizes(self):
        other = self.root / "companies" / "other"
        other.mkdir()
        repo = self.root / "code"
        repo.mkdir()
        (other / "company.json").write_text(json.dumps({"repos": [{"local_path": str(repo)}]}))
        t = converse.new_thread("holding", "Codex", "Compare")
        seen = []
        def run(cmd, **kw):
            seen.append((cmd, kw))
            if kw["cwd"] == self.root:
                return converse.subprocess.CompletedProcess(cmd, 1, stdout="", stderr="Engine crashed")
            Path(cmd[cmd.index("-o") + 1]).write_text("Code exists in src/app.ts.")
            return converse.subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        with patch.object(converse.subprocess, "run", run), patch.object(converse, "take_turn") as summary:
            states = converse.fanout(t, ["demo", "other"], engine="codex", model="example-model")
            summary.assert_called_once()
        self.assertEqual({s["status"] for s in states}, {"done", "failed"})
        self.assertEqual(len(seen), 2)
        for cmd, kw in seen:
            self.assertEqual(cmd[cmd.index("--sandbox") + 1], "read-only")
            self.assertEqual(cmd[cmd.index("-C") + 1], str(kw["cwd"]))
            self.assertEqual(cmd[cmd.index("-m") + 1], "example-model")

    def test_run_automatically_dispatches_ceo_fanout_line(self):
        t = converse.new_thread("holding", "Compare", "Investigate")
        def turn(*args):
            return converse.add_message(t, "ceo", "owner", "reply", "FANOUT: demo, other | Inspect sync")
        with patch.object(converse, "take_turn", turn), patch.object(converse, "fanout") as fan:
            converse.run_thread(t)
            fan.assert_called_once_with(t, ["demo", "other"], "Inspect sync", engine="claude", model=None)
        self.assertIsNone(converse.parse_fanout("I might FANOUT: demo, other | maybe"))

if __name__ == "__main__":
    unittest.main()
