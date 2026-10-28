import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS))
import paths  # noqa: E402


def make_data(root: Path, owner: dict | None = None) -> None:
    (root / "companies" / "demo").mkdir(parents=True)
    (root / "companies" / "demo" / "company.json").write_text(json.dumps({"id": "demo", "name": "Demo"}))
    (root / "holding").mkdir()
    (root / "local").mkdir()
    if owner is not None:
        (root / "local" / "owner.json").write_text(json.dumps(owner))


def run_tool(code: str, root: Path) -> str:
    """Runs Python in a fresh process (ROOT is read at import) with MASTER_REPO_ROOT pointing at root."""
    env = {**os.environ, "MASTER_REPO_ROOT": str(root)}
    return subprocess.run([sys.executable, "-c", code], cwd=TOOLS, env=env, capture_output=True, text=True,
                          check=True).stdout.strip()


class DataRootTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()

    def test_tools_read_the_data_directory_from_the_environment(self):
        make_data(self.root, {"name": "Dana Demo", "short": "Dana"})
        out = run_tool("import paths, converse, portfolio, market, screens, build, safe_fs, git_history\n"
                       "print(paths.ROOT); print({m.ROOT for m in (converse, portfolio, market, screens, build, "
                       "safe_fs, git_history)} == {paths.ROOT}); print(converse.project_slugs())", self.root)
        root, same, slugs = out.split("\n")
        self.assertEqual(root, str(self.root))
        self.assertEqual(same, "True")
        self.assertEqual(slugs, "['demo']")

    def test_without_the_variable_the_checkout_is_the_data_directory(self):
        env = {k: v for k, v in os.environ.items() if k != "MASTER_REPO_ROOT"}
        out = subprocess.run([sys.executable, "-c", "import paths; print(paths.ROOT)"], cwd=TOOLS, env=env,
                             capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(out, str(TOOLS.parent))

    def test_owner_file_and_its_fallback(self):
        make_data(self.root, {"name": "Dana Demo", "short": "Dana"})
        self.assertEqual(paths.owner(self.root), {"name": "Dana Demo", "short": "Dana"})
        (self.root / "local" / "owner.json").unlink()
        self.assertEqual(paths.owner(self.root), {"name": "Owner", "short": "You"})

    def test_identity_values_are_literal_and_missing_config_has_a_setup_message(self):
        make_data(self.root, {"name": "Dana", "emails": ["dana+git@example.com"], "handles": ["dana.dev"]})
        self.assertEqual(paths.owner_identities(self.root), ["dana+git@example.com", "dana.dev"])
        (self.root / "local" / "owner.json").unlink()
        with self.assertRaisesRegex(SystemExit, r"local/owner.example.json"):
            paths.owner_identities(self.root)

    def test_codebase_classification_uses_configured_literal_identities(self):
        from unittest.mock import patch
        import codebases
        make_data(self.root, {"name": "Dana", "emails": ["dana+git@example.com"], "handles": ["dana.dev"]})
        repo = self.root / "repo"
        (repo / ".git").mkdir(parents=True)
        def git_output(_repo, *args):
            if args[0] == "remote":
                return "https://github.com/DANA.DEV/demo.git"
            if "--format=%ae %an" in args:
                return "DANA+GIT@example.com Dana"
            return ""
        with patch.object(codebases, "ROOT", self.root), patch.object(codebases, "git", git_output):
            self.assertEqual(codebases.scan_one(repo, {})["kind"], "own")
            (self.root / "local" / "owner.json").write_text(json.dumps({"handles": ["danaXdev"]}))
            self.assertEqual(codebases.scan_one(repo, {})["kind"], "clone")

    def test_invalid_owner_display_config_uses_neutral_words(self):
        make_data(self.root)
        (self.root / "local" / "owner.json").write_text("[]")
        self.assertEqual(paths.owner(self.root), {"name": "Owner", "short": "You"})

    def test_role_prompts_fall_back_to_the_ones_shipped_with_the_tools(self):
        make_data(self.root)
        self.assertEqual(paths.agents_dir(self.root), paths.CODE / "agents")
        (self.root / "agents").mkdir()
        self.assertEqual(paths.agents_dir(self.root), self.root / "agents")


if __name__ == "__main__":
    unittest.main()
