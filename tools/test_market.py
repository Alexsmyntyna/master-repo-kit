import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import market  # noqa: E402

REAL_ROOT = market.ROOT


class Market(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        market.ROOT = Path(self.tmp.name)
        (market.ROOT / "companies" / "demo").mkdir(parents=True)
        (market.ROOT / "companies" / "demo" / "company.json").write_text("{}")

    def tearDown(self):
        market.ROOT = REAL_ROOT
        self.tmp.cleanup()

    def test_fetched_facts_refresh_but_agent_judgment_stays(self):
        market.upsert("demo", {"id": "app-1", "name": "Old", "appstore": {"rating": 4.1}})
        data = market.load("demo")
        data["competitors"][0].update(threat="high", complaints=["ads"])
        market.save("demo", data)
        market.upsert("demo", {"id": "app-1", "name": "New", "appstore": {"rating": 4.5}, "threat": "low"})
        c = market.load("demo")["competitors"][0]
        self.assertEqual((c["name"], c["appstore"]["rating"], c["threat"], c["complaints"]), ("New", 4.5, "high", ["ads"]))

    def test_only_public_web_addresses_and_known_projects(self):
        for url in ("http://127.0.0.1:3100", "http://localhost/", "http://10.0.0.1/", "file:///etc/passwd",
                    "http://169.254.169.254/latest"):
            with self.assertRaises(SystemExit):
                market.public_url(url)
        with self.assertRaises(SystemExit):
            market.market_dir("../etc")
        with self.assertRaises(SystemExit):
            market.reviews("demo", "../../x", 1)
        # NAT64 (64:ff9b::/96 or the network's own prefix) embeds the IPv4 it reaches: judge that one
        self.assertFalse(market.is_public("64:ff9b::a00:1"))
        self.assertFalse(market.is_public("::ffff:127.0.0.1"))
        self.assertTrue(market.is_public("64:ff9b::5db8:d822"))

    def test_guard_proxy_refuses_local_destinations_even_mid_navigation(self):
        import urllib.error
        import urllib.request
        proxy = market.GuardProxy()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": proxy.url, "https": proxy.url}))
        try:
            for url in ("http://127.0.0.1:3100/", "http://localhost/", "https://10.0.0.1/"):
                with self.assertRaises(urllib.error.URLError):
                    opener.open(url, timeout=10)
        finally:
            proxy.shutdown()
            proxy.server_close()


if __name__ == "__main__":
    unittest.main()
