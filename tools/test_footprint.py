"""Run with: python3 -m unittest tools/test_footprint.py"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).parent))
import footprint  # noqa: E402

REAL_ROOT = footprint.ROOT


class Footprint(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name).resolve()
        footprint.ROOT = self.root = base / "master"
        self.repo = base / "code" / "shop"
        (self.repo / "web").mkdir(parents=True)
        (self.repo / "web" / "package.json").write_text(json.dumps(
            {"homepage": "https://shop.example.com", "dependencies": {"next": "15", "mongoose": "8", "stripe": "16"}}))
        (self.repo / ".do").mkdir()
        (self.repo / ".do" / "app.yaml").write_text("name: shop\nservices:\n  - name: web\n")
        (self.repo / ".env.example").write_text("MONGODB_URI=\nSTRIPE_SECRET_KEY=sk_test_placeholder\n")
        (self.repo / ".env").write_text("SUPABASE_URL=https://real-secret.supabase.co\n")
        (self.repo / ".env.local").write_text("PADDLE_KEY=live\n")
        (self.repo / "server.key").write_text("-----BEGIN PRIVATE KEY-----\n")
        (self.repo / "node_modules" / "pg").mkdir(parents=True)
        (self.repo / "node_modules" / "pg" / "package.json").write_text(json.dumps({"dependencies": {"pg": "1"}}))
        self.company("shop", [{"path": str(self.repo)}], ["https://shop.example.com/", {"path": "https://github.com/a/b"}])

    def tearDown(self):
        footprint.ROOT = REAL_ROOT
        self.tmp.cleanup()

    def company(self, slug, repos, public=()):
        d = self.root / "companies" / slug
        d.mkdir(parents=True, exist_ok=True)
        (d / "company.json").write_text(json.dumps({"id": slug, "name": slug, "repos": repos,
                                                    "links": {"public": list(public)}}))

    def test_detects_hosting_database_payments_and_domains(self):
        fp = footprint.scan("shop")
        self.assertEqual(fp["hosting"], ["digitalocean"])
        self.assertEqual(fp["database"], ["mongodb"])
        self.assertEqual(fp["payments"], ["stripe"])
        self.assertEqual(fp["domains"], ["shop.example.com"])  # github.com is a platform, not a domain
        self.assertIsNone(fp["public_urls_ok"])
        self.assertIn("MONGODB_URI", fp["env_names"])
        self.assertTrue(all(e["path"] for e in fp["evidence"]))
        self.assertEqual(fp["summary"], "DigitalOcean + MongoDB + Stripe; cost unknown")
        saved = json.loads((self.root / "companies" / "shop" / "footprint.json").read_text())
        self.assertEqual(saved["hosting"], ["digitalocean"])

    def test_never_opens_env_files_or_keys_and_never_records_values(self):
        opened = []
        real_open = open

        def spy(path, *a, **k):
            opened.append(Path(path).name)
            return real_open(path, *a, **k)

        with mock.patch("builtins.open", spy):
            fp = footprint.scan("shop")
        self.assertNotIn(".env", opened)
        self.assertNotIn(".env.local", opened)
        self.assertNotIn("server.key", opened)
        text = (self.root / "companies" / "shop" / "footprint.json").read_text()
        self.assertNotIn("sk_test_placeholder", text)
        self.assertNotIn("supabase", fp["database"])  # only in .env, which is never read
        self.assertNotIn("postgres", fp["database"])  # node_modules is skipped

    def test_keeps_monthly_cost_and_unknown_keys(self):
        path = self.root / "companies" / "shop" / "footprint.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"monthly_cost": 12, "note": "from the owner"}))
        fp = footprint.scan("shop")
        self.assertEqual((fp["monthly_cost"], fp["note"]), (12, "from the owner"))
        self.assertEqual(fp["summary"], "DigitalOcean + MongoDB + Stripe; 12/mo")

    def test_project_without_repos(self):
        self.company("idea", [])
        fp = footprint.scan("idea")
        self.assertEqual((fp["hosting"], fp["repos"]), ([], []))
        self.assertEqual(fp["summary"], "nothing hosted, stored or billed found in code")

    def test_missing_repo_is_a_warning(self):
        self.company("gone", [{"path": str(self.root / "nowhere")}])
        self.assertIn("repo not found", footprint.scan("gone")["warnings"][0])

    def test_probe_records_status(self):
        with mock.patch.object(footprint, "probe", return_value={"url": "x", "status": 200, "ok": True}) as p:
            fp = footprint.scan("shop", do_probe=True)
        self.assertEqual(p.call_count, 2)
        self.assertTrue(fp["public_urls_ok"])
        self.assertEqual(len(fp["probes"]), 2)


if __name__ == "__main__":
    unittest.main()
