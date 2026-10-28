import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import pointer  # noqa: E402

REAL_ROOT = pointer.ROOT


class Pointer(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        pointer.ROOT = self.root = base / "master"
        self.code = base / "code"
        for name in ("plain", "both", "importer", "mixed", "shared", "linked"):
            (self.code / name).mkdir(parents=True)
        self.company("plain", "plain")
        self.company("both", "both")
        self.company("importer", "importer")
        self.company("site", "shared")
        self.company("photos", "shared")
        self.company("linked", "linked")
        self.company("mixed", "mixed")
        self.company("gone", "missing")
        (self.root / "companies" / "_template").mkdir(parents=True)
        (self.root / "companies" / "_template" / "company.json").write_text('{"repos": []}')
        (self.code / "both" / "AGENTS.md").write_text("# Agents\n\nRules.\n")
        (self.code / "both" / "CLAUDE.md").write_text("# Claude\n\nMore rules.")
        (self.code / "importer" / "AGENTS.md").write_text("# Agents\n")
        (self.code / "importer" / "CLAUDE.md").write_text("<!-- shared -->\n\n@AGENTS.md\n")
        (self.code / "mixed" / "AGENTS.md").write_text("# Agents\n")
        (self.code / "mixed" / "CLAUDE.md").write_text("# Claude\n\n@AGENTS.md\n\nOwn notes.\n")
        (self.code / "linked" / "CLAUDE.md").write_text("# Claude\n")
        (self.code / "linked" / "AGENTS.md").symlink_to("CLAUDE.md")

    def tearDown(self):
        pointer.ROOT = REAL_ROOT
        self.tmp.cleanup()

    def company(self, slug, folder):
        d = self.root / "companies" / slug
        d.mkdir(parents=True, exist_ok=True)
        (d / "company.json").write_text(json.dumps({"repos": [{"path": str(self.code / folder)}]}))

    def run_cmd(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = pointer.main(list(args))
        return code, out.getvalue(), err.getvalue()

    def snapshot(self):
        return {str(p): p.read_bytes() for p in self.code.rglob("*") if p.is_file() and not p.is_symlink()}

    def test_fresh_install_creates_master_repo_md_and_claude_md(self):
        self.run_cmd("install", "plain")
        repo = self.code / "plain"
        text = (repo / "MASTER-REPO.md").read_text()
        self.assertIn("inbox.py context plain", text)
        self.assertIn("`companies/plain/`", text)
        self.assertNotIn("{{", text)
        claude = (repo / "CLAUDE.md").read_text()
        self.assertTrue(claude.startswith(pointer.START) and claude.endswith(pointer.END + "\n"))
        self.assertIn("./MASTER-REPO.md", claude)
        self.assertFalse((repo / "AGENTS.md").exists())

    def test_block_goes_into_agents_md_and_a_claude_md_that_has_its_own_content(self):
        self.run_cmd("install", "both")
        agents = (self.code / "both" / "AGENTS.md").read_text()
        self.assertTrue(agents.startswith("# Agents\n\nRules.\n\n" + pointer.START))
        claude = (self.code / "both" / "CLAUDE.md").read_text()
        self.assertTrue(claude.startswith("# Claude\n\nMore rules.\n\n" + pointer.START))

    def test_claude_md_that_only_imports_agents_md_is_left_alone(self):
        self.run_cmd("install", "importer")
        self.assertEqual((self.code / "importer" / "CLAUDE.md").read_text(), "<!-- shared -->\n\n@AGENTS.md\n")
        self.assertIn(pointer.START, (self.code / "importer" / "AGENTS.md").read_text())

    def test_claude_md_that_imports_agents_md_among_its_own_text_gets_no_block(self):
        self.run_cmd("install", "mixed")
        self.assertEqual((self.code / "mixed" / "CLAUDE.md").read_text(), "# Claude\n\n@AGENTS.md\n\nOwn notes.\n")
        self.assertIn(pointer.START, (self.code / "mixed" / "AGENTS.md").read_text())

    def test_install_takes_back_a_block_that_now_sits_in_an_importing_claude_md(self):
        f = self.code / "mixed" / "CLAUDE.md"
        original = f.read_bytes()
        _, block = pointer.templates()
        f.write_text(f.read_text() + "\n" + block + "\n")
        code, out, _ = self.run_cmd("check", "mixed")
        self.assertEqual(code, 1)
        self.assertIn("CLAUDE.md has a block it shouldn't", out)
        self.run_cmd("install", "mixed")
        self.assertEqual(f.read_bytes(), original)
        self.assertEqual(self.run_cmd("check", "mixed")[0], 0)

    def test_symlinked_agents_md_gets_one_block_and_stays_a_link(self):
        self.run_cmd("install", "linked")
        repo = self.code / "linked"
        self.assertTrue((repo / "AGENTS.md").is_symlink())
        self.assertEqual((repo / "CLAUDE.md").read_text().count(pointer.START), 1)

    def test_reinstall_is_byte_identical_and_only_touches_two_kinds_of_file(self):
        before = self.snapshot()
        self.run_cmd("install", "--all")
        first = self.snapshot()
        changed = {Path(p).name for p in first if before.get(p) != first[p]}
        self.assertEqual(changed, {"MASTER-REPO.md", "CLAUDE.md", "AGENTS.md"})
        code, out, _ = self.run_cmd("install", "--all")
        self.assertEqual(self.snapshot(), first)
        self.assertEqual(out.count("up to date"), 6)

    def test_reinstall_replaces_only_between_the_markers(self):
        self.run_cmd("install", "both")
        f = self.code / "both" / "AGENTS.md"
        f.write_text(f.read_text().replace("## Master-Repo\n", "## Old heading\n") + "\nAfter the block.\n")
        self.run_cmd("install", "both")
        text = f.read_text()
        self.assertIn("## Master-Repo\n", text)
        self.assertNotIn("Old heading", text)
        self.assertTrue(text.endswith(pointer.END + "\n\nAfter the block.\n"))

    def test_check_reports_missing_then_ok_then_stale(self):
        code, out, _ = self.run_cmd("check", "--all")
        self.assertEqual(code, 1)
        self.assertIn("MASTER-REPO.md missing", out)
        self.run_cmd("install", "--all")
        code, out, _ = self.run_cmd("check", "--all")
        self.assertEqual(code, 0, out)
        self.assertEqual(len([ln for ln in out.splitlines() if ln.startswith("ok")]), 6)
        (self.code / "plain" / "MASTER-REPO.md").write_text("edited\n")
        f = self.code / "both" / "AGENTS.md"
        f.write_text(f.read_text().replace(pointer.START, "").replace(pointer.END, ""))
        code, out, _ = self.run_cmd("check")
        self.assertEqual(code, 1)
        self.assertIn("MASTER-REPO.md stale", out)
        self.assertIn("AGENTS.md has no block", out)

    def test_shared_path_gets_one_file_listing_every_slug(self):
        _, out, _ = self.run_cmd("install", "site")
        text = (self.code / "shared" / "MASTER-REPO.md").read_text()
        self.assertIn("`companies/photos/`", text)
        self.assertIn("`companies/site/`", text)
        self.assertIn("Ask the owner which one", text)
        self.assertIn("context <slug>", text)
        self.assertIn("(`photos`, `site`)", (self.code / "shared" / "CLAUDE.md").read_text())
        self.assertEqual(out.count("shared"), 1)

    def test_missing_path_is_skipped_with_a_warning(self):
        code, _, err = self.run_cmd("install", "gone")
        self.assertEqual(code, 0)
        self.assertIn("doesn't exist", err)
        self.assertFalse((self.code / "missing").exists())

    def test_the_real_template_parses(self):
        page, block = pointer.templates()
        self.assertIn("{{slug_lines}}", page)
        self.assertTrue(block.startswith(pointer.START) and block.endswith(pointer.END))
        self.assertLessEqual(len(page.splitlines()), 45)


if __name__ == "__main__":
    unittest.main()
