import json
import shutil
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402
import converse  # noqa: E402

REAL = (converse.ROOT, build.ROOT, build.WORKTREES)
# Stands in for `claude -p`: reads the prompt, writes and commits a file, prints stream-json like the real one.
FAKE_CLAUDE = """#!/usr/bin/env python3
import json, subprocess, sys
prompt = sys.stdin.read()
print(json.dumps({"type": "system", "subtype": "init", "session_id": "sess-1"}))
if "--resume" in sys.argv:
    open("more.txt", "w").write("direction followed\\n")
else:
    open("feature.txt", "a").write("built\\n")
if "Draw the phone" in prompt:  # a design brief: one mockup review, written where CODER_RULE says
    import os, re
    d = re.search(r"`(/[^`]*master-repo-mockups)/", prompt).group(1) + "/2026-10-11-phone"
    os.makedirs(d, exist_ok=True)
    open(d + "/index.html", "w").write("<p>phone</p>")
    open(d + "/review.md", "w").write("---\\ntitle: Phone\\nstatus: open\\n---\\n| a | b |\\n")
    open(d + "/notes.md", "w").write("not the agent's to write")
    os.symlink("/etc/hosts", d + "/hosts.html")
subprocess.run(["git", "add", "-A"]); subprocess.run(["git", "commit", "-qm", "agent work"])
print(json.dumps({"type": "result", "result": "Changed feature.txt; checked it.", "total_cost_usd": 0.5,
                  "session_id": "sess-1", "is_error": False}))
"""


def sh(cwd, *args):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class Builds(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        t = Path(self.tmp.name).resolve()
        self.root, self.repo, bin_ = t / "mr", t / "repo", t / "bin"
        converse.ROOT = build.ROOT = self.root
        build.WORKTREES = t / "worktrees"
        (self.root / "companies" / "demo").mkdir(parents=True)
        (self.root / "agents").mkdir()
        (self.root / "agents" / "coo.md").write_text("---\nname: coo\n---\nYou are the COO.")
        (self.root / "holding").mkdir()
        (self.root / "companies" / "demo" / "company.json").write_text(json.dumps(
            {"name": "Demo", "repos": [{"path": str(self.repo), "role": "primary"}]}))
        self.repo.mkdir()
        sh(self.repo, "git", "init", "-q", "-b", "main")
        sh(self.repo, "git", "-c", "user.email=a@b", "-c", "user.name=A", "commit", "-q", "--allow-empty", "-m", "start")
        (self.repo / "node_modules").mkdir()  # installed, untracked: linked into worktrees, never counted as work
        bin_.mkdir()
        (bin_ / "claude").write_text(FAKE_CLAUDE)
        (bin_ / "claude").chmod(0o755)
        self.env = {k: os.environ.get(k) for k in ("PATH", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL")}
        os.environ.update(PATH=f"{bin_}:{os.environ['PATH']}", GIT_AUTHOR_NAME="A", GIT_AUTHOR_EMAIL="a@b",
                          GIT_COMMITTER_NAME="A", GIT_COMMITTER_EMAIL="a@b")
        self.reviews = []
        self.real_run_claude = converse.run_claude
        converse.run_claude = lambda prompt, role, scope, model, **kw: (self.reviews.append(prompt), ("Ready.", {}))[1]

    def tearDown(self):
        converse.ROOT, build.ROOT, build.WORKTREES = REAL
        converse.run_claude = self.real_run_claude
        for k, v in self.env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self.tmp.cleanup()

    def make_build(self):
        d = self.root / "companies" / "demo" / "builds" / "b1"
        d.mkdir(parents=True)
        converse.write_doc(d / "build.md", {"title": "Feature", "status": "approved", "approved": "2026-10-10T00:00:00",
                                            "base": "main"}, "Build a feature.")
        (d / "01-feature.md").write_text("---\ntitle: Add the feature\n---\n\n## Goal\nfeature.txt")
        return d

    def test_agents_work_on_their_own_branch_and_only_a_clean_merge_reaches_main(self):
        d = self.make_build()
        build.run("demo", "b1")
        s = build.read_run(d, "01")
        self.assertEqual((s["status"], s["commits"], s["session"], s["branch"]), ("done", 1, "sess-1", "mr/b1-01"))
        self.assertIn("Your brief", (d / "runs" / "01.log").read_text())
        self.assertTrue((Path(s["worktree"]) / "node_modules").is_symlink())
        self.assertFalse(s["dirty"])
        self.assertNotIn("node_modules", sh(Path(s["worktree"]), "git", "ls-files"))  # never committed by `add -A`
        self.assertFalse((self.repo / "feature.txt").exists())  # the checked-out repo is untouched
        self.assertEqual(build.read_meta(d / "build.md")["status"], "review")
        self.assertIn("Changed feature.txt", self.reviews[0])  # the COO reviewed the agent's report and diff

        build.say("demo", "b1", "01", "Also write more.txt")
        self.assertEqual(build.read_run(d, "01")["commits"], 2)

        (self.repo / "wip.txt").write_text("the owner's own work")
        with self.assertRaises(SystemExit):
            build.merge("demo", "b1", "01")  # never over uncommitted work
        (self.repo / "wip.txt").unlink()
        build.merge("demo", "b1", "01")
        self.assertTrue((self.repo / "feature.txt").exists())
        build.discard("demo", "b1", "01")
        self.assertFalse(Path(s["worktree"]).exists())
        self.assertEqual(build.read_run(d, "01")["status"], "merged")

    def test_mockup_reviews_are_collected_into_master_repo_and_never_committed(self):
        d = self.make_build()
        (d / "01-feature.md").write_text("---\ntitle: Phone mockup\n---\n\n## Goal\nDraw the phone.")
        build.run("demo", "b1")
        s = build.read_run(d, "01")
        out = self.root / "companies" / "demo" / "mockups" / "2026-10-11-phone"
        self.assertEqual(s["mockups"], ["2026-10-11-phone"])
        self.assertEqual(sorted(p.name for p in out.iterdir()), ["index.html", "review.md"])  # no notes, no links
        self.assertNotIn("master-repo-mockups", sh(Path(s["worktree"]), "git", "ls-files"))
        self.assertFalse(s["dirty"])
        # A review the owner has answered is never overwritten by a later run.
        (out / "review.md").write_text("---\ntitle: Phone\nstatus: answered\n---\n")
        self.assertEqual(build.collect_mockups("demo", s["worktree"]), [])
        self.assertIn("answered", (out / "review.md").read_text())
        # A planted link in the review folder never redirects the copy outside Master-Repo.
        victim = self.root / "victim.txt"
        victim.write_text("keep")
        (out / "review.md").unlink()
        (out / "index.html").unlink()
        (out / "index.html").symlink_to(victim)
        self.assertEqual(build.collect_mockups("demo", s["worktree"]), ["2026-10-11-phone"])
        self.assertEqual(victim.read_text(), "keep")
        self.assertFalse((out / "index.html").is_symlink())
        # ...nor does a hard link to a file outside.
        (out / "index.html").unlink()
        os.link(victim, out / "index.html")
        build.collect_mockups("demo", s["worktree"])
        self.assertEqual(victim.read_text(), "keep")
        # ...and a hard link the agent plants in its own folder never copies a private file in.
        secret = self.root / "secret.txt"
        secret.write_text("private")
        src_review = Path(s["worktree"]) / build.MOCKUPS / "2026-10-11-phone"
        (src_review / "index.html").unlink()
        os.link(secret, src_review / "index.html")
        (out / "index.html").unlink()
        build.collect_mockups("demo", s["worktree"])
        self.assertFalse((out / "index.html").exists())
        # ...and a named pipe in its place is skipped instead of hanging the copy.
        (src_review / "index.html").unlink()
        os.mkfifo(src_review / "index.html")
        self.assertEqual(build.collect_mockups("demo", s["worktree"]), ["2026-10-11-phone"])
        # ...nor does a linked review folder.
        shutil.rmtree(out)
        elsewhere = self.root / "elsewhere"
        elsewhere.mkdir()
        out.symlink_to(elsewhere, target_is_directory=True)
        self.assertEqual(build.collect_mockups("demo", s["worktree"]), [])
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_ids_and_brief_numbers_are_validated(self):
        self.make_build()
        for bad in (lambda: build.build_dir("demo", "../x"), lambda: build.read_run(self.root, "../1"),
                    lambda: build.project("../etc"), lambda: build.merge("demo", "b1", "1; rm")):
            with self.assertRaises(SystemExit):
                bad()

    def test_the_coder_shell_is_sandboxed_to_its_worktree_and_own_git_paths(self):
        d = self.make_build()
        build.run("demo", "b1")
        state = build.read_run(d, "01")
        cmd = build.coder_cmd("sonnet", state=state)
        settings = json.loads(cmd[cmd.index("--settings") + 1])
        self.assertEqual({k: v for k, v in settings["sandbox"].items() if k != "filesystem"},
                         {"enabled": True, "autoAllowBashIfSandboxed": True, "allowUnsandboxedCommands": False})
        allowed = settings["permissions"]["allow"]
        git_dir = str((self.repo / ".git").resolve())
        self.assertIn(f"Edit(/{git_dir}/objects/**)", allowed)
        self.assertIn(f"Edit(/{git_dir}/refs/heads/mr/b1-01)", allowed)  # its own branch, not every mr/*
        self.assertIn(f"Edit(/{state['admin']}/index)", allowed)
        joined = " ".join(allowed)
        for forbidden in ("/hooks", "/config", "commondir", "gitdir", f"{git_dir}/**", "refs/heads/mr/**", f"{state['admin']}/**"):
            self.assertNotIn(forbidden, joined)
        self.assertIn("Read(~/.ssh/**)", settings["permissions"]["deny"])
        self.assertIn("Read(**/.env)", settings["permissions"]["deny"])
        for path in (".git", ".claude/**", ".zed/**", ".envrc"):
            self.assertIn(f"Edit(/{state['worktree']}/{path})", settings["permissions"]["deny"])
        self.assertEqual(cmd[cmd.index("--setting-sources") + 1], "user")  # worktree settings never load
        fs = settings["sandbox"]["filesystem"]
        for path in (".git", ".zed", "**/.zed", ".envrc", "**/.envrc", ".claude"):
            self.assertIn(f"{state['worktree']}/{path}", fs["denyWrite"])  # the shell, not just the file tools
        self.assertIn(str(Path.home() / ".ssh"), fs["denyRead"])
        self.assertIn(f"{self.repo}/**/.env", fs["denyRead"])  # the checkout's .env, not just the worktree's
        self.assertIn(f"{state['worktree']}/.env.*", fs["denyRead"])
        tools = cmd[cmd.index("--allowedTools") + 1:cmd.index("--disallowedTools")]
        self.assertNotIn("Bash", tools)  # never pre-approved outside the sandbox
        self.assertNotIn("--dangerously-skip-permissions", cmd)

    def test_a_worktree_whose_git_link_was_changed_is_never_trusted(self):
        d = self.make_build()
        build.run("demo", "b1")
        wt = Path(build.read_run(d, "01")["worktree"])
        evil = wt / "evil-git"
        evil.mkdir()
        (evil / "config").write_text("[core]\n\tfsmonitor = touch /tmp/mr-pwned\n")
        (wt / ".git").write_text(f"gitdir: {evil}\n")
        for action in (lambda: build.merge("demo", "b1", "01"), lambda: build.say("demo", "b1", "01", "go on"),
                       lambda: build.open_in("demo", "b1", "01", True, None, False)):
            with self.assertRaises(SystemExit):
                action()
        build.discard("demo", "b1", "01")  # removed without git ever reading it
        self.assertFalse(wt.exists())
        self.assertFalse(Path("/tmp/mr-pwned").exists())

    def test_config_committed_without_touching_disk_is_never_merged_from_the_app(self):
        d = self.make_build()
        build.run("demo", "b1")
        wt = Path(build.read_run(d, "01")["worktree"])
        blob = subprocess.run(["git", "hash-object", "-w", "--stdin"], cwd=wt, input='{"hooks": {}}', capture_output=True,
                              text=True, check=True).stdout.strip()
        sh(wt, "git", "update-index", "--add", "--cacheinfo", f"100644,{blob},.claude/settings.json")
        sh(wt, "git", "commit", "-qm", "settings")
        sh(wt, "git", "reset", "-q", "--hard")  # keep the worktree clean, as the agent would
        for odd in (".CLAUDE/settings.local.json", ".claude/sett\tings.json", "app/.ENVRC", "docs/Claude.md"):
            blob2 = subprocess.run(["git", "hash-object", "-w", "--stdin"], cwd=wt, input="x", capture_output=True,
                                   text=True, check=True).stdout.strip()
            sh(wt, "git", "update-index", "--add", "--cacheinfo", f"100644,{blob2},{odd}")
        sh(wt, "git", "commit", "-qm", "more")
        touched = build.config_touched(self.repo, build.read_run(d, "01")["base_sha"], "mr/b1-01")
        self.assertEqual(sorted(touched), sorted([".claude/settings.json", ".CLAUDE/settings.local.json",
                                                  ".claude/sett\tings.json", "app/.ENVRC", "docs/Claude.md"]))
        with self.assertRaises(SystemExit):
            build.merge("demo", "b1", "01")
        self.assertFalse((self.repo / ".claude").exists())
        with self.assertRaises(SystemExit):
            build.config_touched(self.repo, "no-such-base", "mr/b1-01")  # fails closed, never "nothing touched"
        build.review("demo", "b1")
        self.assertIn("CONFIG CHANGED", self.reviews[-1])  # the COO is told too

    def test_a_branch_that_adds_a_symlink_is_never_merged_from_the_app(self):
        d = self.make_build()
        build.run("demo", "b1")
        wt = Path(build.read_run(d, "01")["worktree"])
        (wt / "notes").symlink_to(Path.home() / ".ssh")
        sh(wt, "git", "add", "notes")
        sh(wt, "git", "commit", "-qm", "link")
        self.assertIn("notes (symlink)", build.config_touched(self.repo, "main", "mr/b1-01"))
        with self.assertRaises(SystemExit):
            build.merge("demo", "b1", "01")
        self.assertFalse((self.repo / "notes").exists())

    def test_a_plan_that_failed_half_way_is_not_approved(self):
        d = self.make_build()
        build.update_build(d, status="failed", approved="")
        with self.assertRaises(SystemExit):
            build.run("demo", "b1")


    def test_an_epic_runs_only_once_approved_and_in_sequence_each_subtask_builds_on_the_last(self):
        d = self.make_build()
        (d / "02-more.md").write_text("---\ntitle: Build on it\nneeds: 01\n---\n\n## Goal\nmore")
        build.update_build(d, status="proposed")
        with self.assertRaises(SystemExit):
            build.run("demo", "b1")  # nothing runs before the owner approves
        build.approve("demo", "b1")
        build.run("demo", "b1", mode="sequence")
        one, two = build.read_run(d, "01"), build.read_run(d, "02")
        self.assertEqual((one["status"], two["status"], two["stacked_on"]), ("done", "done", "mr/b1-01"))
        self.assertTrue((Path(two["worktree"]) / "feature.txt").exists())  # it started from 01's work
        self.assertEqual(two["commits"], 1)  # its own commit only
        build.merge("demo", "b1", "02")
        self.assertEqual(build.read_run(d, "01")["status"], "merged")  # came in with 02

    def test_replan_sets_aside_only_what_has_not_started(self):
        d = self.make_build()
        (d / "02-more.md").write_text("---\ntitle: Later\n---\nlater")
        build.run("demo", "b1", only="01")
        build.replan("demo", "b1", "Drop the second part; make it smaller.")
        self.assertEqual([n for n, _ in build.briefs(d)], ["01"])  # the started one stays
        self.assertTrue(list(d.glob("set-aside/*/02-more.md")))
        self.assertIn("Number new briefs from 03", self.reviews[-1])
        self.assertIn("make it smaller", self.reviews[-1])

    def test_a_one_off_task_is_one_approved_subtask_in_alexs_words(self):
        d = build.task("demo", "Fix the typo on the about screen")
        self.assertEqual(build.read_meta(d / "build.md")["status"], "approved")
        self.assertEqual([p.name for _, p in build.briefs(d)], ["01-task.md"])
        self.assertIn("typo on the about screen", (d / "01-task.md").read_text())

    def test_what_alex_typed_is_kept_on_the_epic_only_when_the_fixer_changed_it(self):
        d = build.task("demo", "Fix the history screen", typed="Fix the hustory screen")
        meta, goal = build.converse.split_frontmatter((d / "build.md").read_text())
        self.assertEqual((meta["typed"], goal.strip()), ("Fix the hustory screen", "Fix the history screen"))
        d = build.task("demo", "Fix the about screen", typed="Fix the about screen")
        self.assertNotIn("typed", build.read_meta(d / "build.md"))
        self.assertEqual(build.typed_field("the fields", "the feilds"), {"typed": "the feilds"})
        self.assertEqual(build.typed_field("the fields", None), {})


if __name__ == "__main__":
    unittest.main()
