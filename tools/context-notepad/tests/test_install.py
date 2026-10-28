import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import _paths  # noqa: F401
import install

SCRIPT = "tools/context-notepad/session_digest.py"
SKILL_COPIES = (".agents/skills/context-notepad/SKILL.md", ".claude/skills/context-notepad/SKILL.md")


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.tmp, ignore_errors=True))
        self.target = self.tmp / "repo"
        self.target.mkdir()
        # A private payload copy lets a test pretend a newer release exists.
        self.payload = self.tmp / "payload"
        shutil.copytree(install.PAYLOAD_DIR, self.payload, ignore=shutil.ignore_patterns("__pycache__"))

    def run_install(self, update=False, apply=True, version="0.1.0", hooks=False):
        self.output = io.StringIO()
        with contextlib.redirect_stdout(self.output), contextlib.redirect_stderr(io.StringIO()):
            return install.command_install(self.target, update, apply, self.payload, version, hooks=hooks)

    def test_fresh_install_copies_files_writes_lock_config_and_blocks(self):
        (self.target / "AGENTS.md").write_text("# Agents\nSee CLAUDE.md\n")
        self.assertEqual(self.run_install(apply=False), 0)
        self.assertFalse((self.target / SCRIPT).exists())

        self.assertEqual(self.run_install(), 0)
        for relative in (SCRIPT, *SKILL_COPIES):
            self.assertTrue((self.target / relative).is_file(), relative)
        lock = install.read_lock(self.target)
        self.assertEqual(lock["files"][SCRIPT], install.sha256_of(self.target / SCRIPT))
        config_text = (self.target / install.CONFIG_FILE).read_text()
        self.assertIn(str(self.target.resolve()), config_text)
        for name in install.INSTRUCTION_FILES:
            self.assertIn("context-notepad:begin v0.1.0", (self.target / name).read_text())

    def test_update_replaces_unmodified_files(self):
        self.run_install()
        (self.payload / install.TOOLS_SOURCE / "notepad.py").write_text("# newer\n")
        self.run_install(update=True, version="0.2.0")
        self.assertEqual((self.target / "tools/context-notepad/notepad.py").read_text(), "# newer\n")
        self.assertEqual(install.read_lock(self.target)["version"], "0.2.0")

    def test_update_preserves_locally_modified_file(self):
        self.run_install()
        local = self.target / SCRIPT
        local.write_text("# my local edit\n")
        (self.payload / install.TOOLS_SOURCE / "session_digest.py").write_text("# newer\n")
        self.run_install(update=True, version="0.2.0")
        self.assertEqual(local.read_text(), "# my local edit\n")
        actions = install.plan_files(self.payload, self.target, install.read_lock(self.target))
        self.assertEqual([a.kind for a in actions if a.path == SCRIPT], [install.CONFLICT])

    def test_managed_block_is_replaced_not_duplicated(self):
        (self.target / "CLAUDE.md").write_text("# Mine\n\nKeep this.\n")
        self.run_install()
        self.run_install(update=True)
        text = (self.target / "CLAUDE.md").read_text()
        self.assertEqual(text.count("context-notepad:begin"), 1)
        self.assertEqual(text.count("context-notepad:end"), 1)
        self.assertTrue(text.startswith("# Mine\n\nKeep this.\n"))

    def test_block_names_the_configured_data_paths(self):
        config = self.target / install.CONFIG_FILE
        config.parent.mkdir(parents=True)
        config.write_text('{"notepad_dir": "~/store/notepads", "activity_log": "~/store/activity.jsonl"}')
        self.run_install()
        text = (self.target / "CLAUDE.md").read_text()
        self.assertIn("`~/store/notepads/<thread>/notepad.md`", text)
        self.assertIn("`~/store/activity.jsonl`", text)
        self.assertNotIn("{notepad_dir}", text)

    def test_existing_config_is_never_overwritten(self):
        config = self.target / install.CONFIG_FILE
        config.parent.mkdir(parents=True)
        config.write_text('{"repo_prefixes": ["/old"]}')
        self.run_install()
        self.assertEqual(config.read_text(), '{"repo_prefixes": ["/old"]}')

    def test_every_payload_skill_and_the_hooks_folder_are_installed(self):
        extra = self.payload / "skills" / "second-skill"
        extra.mkdir()
        (extra / "SKILL.md").write_text("---\nname: second-skill\n---\n")
        self.run_install()
        for root in (".agents/skills", ".claude/skills"):
            self.assertTrue((self.target / root / "second-skill" / "SKILL.md").is_file(), root)
            self.assertTrue((self.target / root / "context-notepad" / "SKILL.md").is_file(), root)
        for relative in ("hooks/log_subagent.py", "hooks/context_reminder.py", "config.example.json", "activity_log.py"):
            self.assertTrue((self.target / "tools/context-notepad" / relative).is_file(), relative)
        self.assertTrue((self.target / install.CONFIG_FILE).is_file())

    def test_update_adds_missing_default_keys_without_touching_existing_values(self):
        self.run_install()
        config = self.target / install.CONFIG_FILE
        data = json.loads(config.read_text())
        for key in ("context_soft_tokens", "mockup_dir"):
            del data[key]
        del data["roles"]["claude"]["scout"]
        data["notepad_dir"] = "custom/threads"
        data["escalation"] = ["only-one"]
        config.write_text(json.dumps(data))

        self.run_install(update=True, apply=False)
        self.assertEqual(json.loads(config.read_text()), data)  # dry run
        self.assertIn("context_soft_tokens", self.output.getvalue())

        self.run_install(update=True)
        merged = json.loads(config.read_text())
        self.assertEqual(merged["context_soft_tokens"], 150000)
        self.assertEqual(merged["roles"]["claude"]["scout"], "haiku")
        self.assertEqual(merged["notepad_dir"], "custom/threads")
        self.assertEqual(merged["escalation"], ["only-one"])
        self.assertEqual(merged["repo_prefixes"], data["repo_prefixes"])


class SymlinkContainmentTests(InstallerTests):
    def setUp(self):
        super().setUp()
        self.outside = self.tmp / "outside"
        self.outside.mkdir()

    def test_symlinked_instruction_file_pointing_outside_is_refused_and_nothing_is_written(self):
        victim = self.outside / "victim.md"
        victim.write_text("keep me\n")
        (self.target / "CLAUDE.md").symlink_to(victim)
        self.assertEqual(self.run_install(), 1)
        self.assertEqual(victim.read_text(), "keep me\n")
        self.assertFalse((self.target / SCRIPT).exists())

    def test_symlinked_tools_folder_pointing_outside_is_refused_even_on_a_dry_run(self):
        (self.target / "tools").symlink_to(self.outside)
        self.assertEqual(self.run_install(apply=False), 1)
        self.assertEqual(list(self.outside.iterdir()), [])

    def test_symlinked_hook_settings_pointing_outside_are_refused(self):
        self.assertEqual(self.run_install(), 0)
        (self.target / ".claude").mkdir(exist_ok=True)
        (self.target / ".claude" / "settings.json").symlink_to(self.outside / "settings.json")
        self.assertEqual(self.run_install(update=True, hooks=True), 1)
        self.assertFalse((self.outside / "settings.json").exists())

    def test_agents_md_symlinked_to_claude_md_inside_the_repo_is_written_once(self):
        (self.target / "CLAUDE.md").write_text("# Mine\n")
        (self.target / "AGENTS.md").symlink_to("CLAUDE.md")
        self.assertEqual(self.run_install(), 0)
        self.assertEqual((self.target / "CLAUDE.md").read_text().count("context-notepad:begin"), 1)


class HookMergeTests(unittest.TestCase):
    def setUp(self):
        self.target = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(self.target, ignore_errors=True))
        self.settings = self.target / ".claude" / "settings.json"
        self.settings.parent.mkdir()
        self.existing = {"permissions": {"allow": ["Bash(ls)"]}, "hooks": {
            "UserPromptSubmit": [{"matcher": "", "hooks": [{"type": "command", "command": "echo mine"}]}],
            "Stop": [{"hooks": [{"type": "command", "command": "echo stop"}]}]}}
        self.settings.write_text(json.dumps(self.existing))

    def run_hooks(self, apply):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            install.command_hooks_only(self.target, apply)
        return out.getvalue()

    def test_dry_run_shows_diff_and_writes_nothing(self):
        output = self.run_hooks(apply=False)
        self.assertIn("log_subagent.py", output)
        self.assertEqual(json.loads(self.settings.read_text()), self.existing)
        self.assertFalse((self.target / ".codex" / "hooks.json").exists())

    def test_apply_keeps_existing_hooks_and_adds_ours_once(self):
        self.run_hooks(apply=True)
        self.run_hooks(apply=True)
        merged = json.loads(self.settings.read_text())
        self.assertEqual(merged["permissions"], self.existing["permissions"])
        self.assertEqual(merged["hooks"]["Stop"], self.existing["hooks"]["Stop"])
        prompt_commands = [h["command"] for g in merged["hooks"]["UserPromptSubmit"] for h in g["hooks"]]
        self.assertEqual(prompt_commands[0], "echo mine")
        self.assertEqual(sum("context_reminder.py" in c for c in prompt_commands), 1)
        for event in ("SubagentStart", "SubagentStop"):
            self.assertEqual(len(merged["hooks"][event]), 1)
        codex = json.loads((self.target / ".codex" / "hooks.json").read_text())
        self.assertEqual(codex["hooks"]["PreToolUse"][0]["matcher"], "spawn_agent")

    def test_invalid_settings_json_is_left_alone(self):
        self.settings.write_text("{not json")
        self.run_hooks(apply=True)
        self.assertEqual(self.settings.read_text(), "{not json")


if __name__ == "__main__":
    unittest.main()
