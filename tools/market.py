#!/usr/bin/env python3
"""Market: what each project is up against, kept as a growing file instead of re-researched every turn.

companies/<slug>/market/
  market.md           agents write it: who buys, how, rough size (with sources), trends, where the gap is
  competitors.json    one entry per competitor. This tool fills the facts it fetches (`appstore`, `web`);
                      agents fill the judgment (who, strengths, complaints, positioning, threat, sources, notes)
  reviews/<id>.json   App Store reviews of a competitor, most recent first (kept in git: small, and the best
                      evidence of what users want and don't get)
  shots/              screenshots, downloaded so agents can look at them (gitignored)

Sources are public and need no login: Apple's iTunes Search/Lookup API, its customer-review feed, and headless
Chrome on public web pages (private and local addresses are refused).

  python3 tools/market.py search <slug> "<term>" [--limit 8] [--add]   find App Store apps; --add keeps them all
  python3 tools/market.py add <slug> <app-id | https://url> [--name N]  keep one app (by id) or web page (by URL)
  python3 tools/market.py reviews <slug> <app-id> [--pages 2]           fetch its reviews
  python3 tools/market.py refresh <slug>                                re-check every app's rating, price, version
  python3 tools/market.py status [<slug>]
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import re
import select
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Master-Repo market research"
MAX_SHOTS = 8
JUDGMENT = ("who", "strengths", "complaints", "positioning", "threat", "sources", "notes")


def today() -> str:
    return dt.date.today().isoformat()


def market_dir(slug: str) -> Path:
    if not re.fullmatch(r"[a-z0-9-]+", slug) or not (ROOT / "companies" / slug / "company.json").exists():
        raise SystemExit(f"No project {slug!r}")
    return ROOT / "companies" / slug / "market"


def load(slug: str) -> dict:
    path = market_dir(slug) / "competitors.json"
    return json.loads(path.read_text()) if path.exists() else {"updated": None, "competitors": []}


def save(slug: str, data: dict) -> None:
    folder = market_dir(slug)
    folder.mkdir(parents=True, exist_ok=True)
    data["updated"] = today()
    (folder / "competitors.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def upsert(slug: str, entry: dict) -> dict:
    """Merge fetched facts into an entry, never touching the judgment agents wrote."""
    data = load(slug)
    current = next((c for c in data["competitors"] if c["id"] == entry["id"]), None)
    if current:
        for key, value in entry.items():
            if key not in JUDGMENT:
                current[key] = value
    else:
        current = {**{k: ([] if k in ("strengths", "complaints", "sources") else None) for k in JUDGMENT}, **entry}
        data["competitors"].append(current)
    save(slug, data)
    return current


def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


_nat64: list[ipaddress.IPv6Network] | None = None


def nat64_prefixes() -> list[ipaddress.IPv6Network]:
    """On NAT64 networks the resolver turns IPv4 (even 10.0.0.1) into IPv6 under a prefix; learn it (RFC 7050)."""
    global _nat64
    if _nat64 is None:
        found = {ipaddress.IPv6Network("64:ff9b::/96")}
        try:
            for info in socket.getaddrinfo("ipv4only.arpa", None, socket.AF_INET6, socket.SOCK_STREAM):
                found.add(ipaddress.IPv6Network(f"{info[4][0].split('%')[0]}/96", strict=False))
        except socket.gaierror:
            pass
        _nat64 = list(found)
    return _nat64


def is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%")[0])
    if ip.version == 6:
        if ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        elif any(ip in net for net in nat64_prefixes()):
            ip = ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)  # the IPv4 address NAT64 will actually reach
    return ip.is_global


def public_ip(host: str) -> str:
    """One vetted public address for a host; every address it resolves to must be public. IP literals are
    judged as written, not after the resolver rewrites them."""
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None and not literal.is_global:
        raise SystemExit(f"{host} is not a public address")
    try:
        addresses = [info[4][0] for info in socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)]
    except socket.gaierror:
        raise SystemExit(f"Can't resolve {host}")
    if not addresses or not all(is_public(a) for a in addresses):
        raise SystemExit(f"{host} is not a public address")
    return addresses[0]


def public_url(url: str) -> str:
    """Only http(s) pages on public addresses: agents choose these URLs, so nothing local or private."""
    parts = urllib.parse.urlparse(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise SystemExit(f"Not a web address: {url}")
    public_ip(parts.hostname)
    return url


class GuardProxy(socketserver.ThreadingTCPServer):
    """Chrome sends every request through this (redirects and subresources included). Each connection is
    resolved here, checked to be public, and made to that vetted address, so nothing reaches loopback, the LAN
    or cloud metadata, and DNS can't change its answer between check and connect."""
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), GuardHandler)
        threading.Thread(target=self.serve_forever, daemon=True).start()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


class GuardHandler(socketserver.BaseRequestHandler):
    def handle(self):
        client = self.request
        client.settimeout(30)
        head = b""
        while b"\r\n\r\n" not in head and len(head) < 65536:
            chunk = client.recv(4096)
            if not chunk:
                return
            head += chunk
        line, _, rest = head.partition(b"\r\n")
        try:
            method, target, version = line.decode("latin-1").split(" ", 2)
            if method == "CONNECT":
                host, _, port = target.rpartition(":")
                upstream = self.open(host.strip("[]"), int(port))
                client.sendall(b"HTTP/1.1 200 Connection established\r\n\r\n")
                leftover = head.partition(b"\r\n\r\n")[2]
            else:
                parts = urllib.parse.urlsplit(target)
                if parts.scheme != "http" or not parts.hostname:
                    raise ValueError
                upstream = self.open(parts.hostname, parts.port or 80)
                path = urllib.parse.urlunsplit(("", "", parts.path or "/", parts.query, ""))
                leftover = f"{method} {path} {version}\r\n".encode("latin-1") + rest
        except (ValueError, OSError, SystemExit):
            client.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
            return
        with upstream:
            if leftover:
                upstream.sendall(leftover)
            pipe(client, upstream)

    @staticmethod
    def open(host: str, port: int) -> socket.socket:
        if port not in (80, 443):
            raise ValueError
        return socket.create_connection((public_ip(host), port), timeout=30)


def pipe(a: socket.socket, b: socket.socket) -> None:
    while True:
        ready, _, _ = select.select([a, b], [], [], 30)
        if not ready:
            return
        for s in ready:
            data = s.recv(65536)
            if not data:
                return
            (b if s is a else a).sendall(data)


# --- App Store ------------------------------------------------------------------------------------------

def itunes(path: str, **params) -> list[dict]:
    query = urllib.parse.urlencode({"entity": "software", "country": "us", **params})
    return json.loads(fetch(f"https://itunes.apple.com/{path}?{query}")).get("results", [])


def app_entry(slug: str, app: dict) -> dict:
    cid = f"app-{app['trackId']}"
    shots_dir = market_dir(slug) / "shots" / cid
    shots_dir.mkdir(parents=True, exist_ok=True)
    urls = (app.get("screenshotUrls") or app.get("ipadScreenshotUrls") or [])[:MAX_SHOTS]
    shots = []
    for i, url in enumerate(urls, 1):
        file = shots_dir / f"{i:02d}{Path(urllib.parse.urlparse(url).path).suffix or '.jpg'}"
        if not file.exists():
            try:
                file.write_bytes(fetch(url))
            except OSError:
                continue
        shots.append({"url": url, "path": str(file.relative_to(ROOT))})
    return {
        "id": cid,
        "name": app.get("trackName"),
        "kind": "app",
        "url": app.get("trackViewUrl"),
        "appstore": {
            "id": app["trackId"], "seller": app.get("sellerName"), "price": app.get("formattedPrice"),
            "rating": round(app["averageUserRating"], 2) if app.get("averageUserRating") else None,
            "ratings": app.get("userRatingCount"), "genre": app.get("primaryGenreName"),
            "version": app.get("version"), "released": (app.get("releaseDate") or "")[:10],
            "last_update": (app.get("currentVersionReleaseDate") or "")[:10],
            "icon": app.get("artworkUrl512") or app.get("artworkUrl100"),
            "description": (app.get("description") or "")[:1500], "shots": shots, "checked": today(),
        },
    }


def search(slug: str, term: str, limit: int, add: bool) -> list[dict]:
    apps = itunes("search", term=term, limit=limit)
    for app in apps:
        line = (f"{app['trackId']:>11}  {app.get('trackName')}  ·  {app.get('sellerName')}  ·  "
                f"{app.get('formattedPrice')}  ·  ★{round(app.get('averageUserRating') or 0, 1)} "
                f"({app.get('userRatingCount') or 0})")
        print(line)
        if add:
            upsert(slug, app_entry(slug, app))
    if add:
        print(f"kept {len(apps)} in companies/{slug}/market/competitors.json")
    return apps


def add_app(slug: str, app_id: str) -> dict:
    if not app_id.isdigit():
        raise SystemExit(f"Not an App Store id: {app_id}")
    found = itunes("lookup", id=app_id)
    if not found:
        raise SystemExit(f"No App Store app {app_id}")
    entry = upsert(slug, app_entry(slug, found[0]))
    print(f"kept {entry['name']} ({entry['id']}), {len(entry['appstore']['shots'])} screenshots")
    return entry


def reviews(slug: str, app_id: str, pages: int) -> list[dict]:
    if not app_id.isdigit():
        raise SystemExit(f"Not an App Store id: {app_id}")
    out = []
    for page in range(1, pages + 1):
        url = f"https://itunes.apple.com/us/rss/customerreviews/page={page}/id={app_id}/sortby=mostrecent/json"
        entries = json.loads(fetch(url)).get("feed", {}).get("entry") or []
        if isinstance(entries, dict):
            entries = [entries]
        for e in entries:
            if "im:rating" not in e:
                continue  # the first entry of some feeds is the app itself
            out.append({"rating": int(e["im:rating"]["label"]), "title": e.get("title", {}).get("label"),
                        "text": e.get("content", {}).get("label"), "version": e.get("im:version", {}).get("label"),
                        "date": (e.get("updated", {}).get("label") or "")[:10]})
        if not entries:
            break
    folder = market_dir(slug) / "reviews"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"app-{app_id}.json").write_text(json.dumps({"fetched": today(), "reviews": out}, indent=2,
                                                          ensure_ascii=False) + "\n")
    low = [r for r in out if r["rating"] <= 3]
    print(f"{len(out)} reviews ({len(low)} at 3 stars or less) -> companies/{slug}/market/reviews/app-{app_id}.json")
    return out


def refresh(slug: str) -> None:
    for c in load(slug)["competitors"]:
        if c.get("appstore"):
            add_app(slug, str(c["appstore"]["id"]))


# --- Web ------------------------------------------------------------------------------------------------

def add_web(slug: str, url: str, name: str | None) -> dict:
    url = public_url(url)
    host = urllib.parse.urlparse(url).hostname.removeprefix("www.")
    cid = "web-" + re.sub(r"[^a-z0-9]+", "-", host.lower()).strip("-")
    page = re.sub(r"[^a-z0-9]+", "-", urllib.parse.urlparse(url).path.lower()).strip("-") or "home"
    folder = market_dir(slug) / "shots" / cid
    folder.mkdir(parents=True, exist_ok=True)
    file = folder / f"{page}.png"
    proxy = GuardProxy()
    try:
        with tempfile.TemporaryDirectory() as profile:
            subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--virtual-time-budget=6000",
                            f"--user-data-dir={profile}", "--no-first-run", "--disable-quic",
                            # everything through the guard: "<-loopback>" stops Chrome bypassing it for localhost
                            f"--proxy-server={proxy.url}", "--proxy-bypass-list=<-loopback>",
                            "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                            "--window-size=1440,2400", f"--screenshot={file}", url], capture_output=True, timeout=120)
    finally:
        proxy.shutdown()
        proxy.server_close()
    if not file.exists():
        raise SystemExit(f"Couldn't capture {url}")
    current = next((c for c in load(slug)["competitors"] if c["id"] == cid), {})
    pages = [p for p in (current.get("web") or {}).get("pages", []) if p["url"] != url]
    pages.append({"url": url, "path": str(file.relative_to(ROOT)), "captured": today()})
    entry = upsert(slug, {"id": cid, "name": name or current.get("name") or host,
                          "kind": current.get("kind") or "web", "url": current.get("url") or url,
                          "web": {"pages": pages}})
    print(f"captured {url} -> {file.relative_to(ROOT)}")
    return entry


def status(slug: str | None) -> None:
    slugs = [slug] if slug else sorted(p.parent.parent.name for p in ROOT.glob("companies/*/market/competitors.json"))
    for s in slugs:
        data = load(s)
        has_md = (market_dir(s) / "market.md").exists()
        print(f"{s}: {len(data['competitors'])} competitors, market.md {'yes' if has_md else 'no'}, "
              f"updated {data.get('updated') or 'never'}")
        for c in data["competitors"]:
            a = c.get("appstore") or {}
            print(f"  {c['id']:<28} {c.get('name')}  {('★' + str(a['rating'])) if a.get('rating') else ''} "
                  f"{'threat ' + c['threat'] if c.get('threat') else ''}")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("search"); p.add_argument("slug"); p.add_argument("term")
    p.add_argument("--limit", type=int, default=8); p.add_argument("--add", action="store_true")
    p = sub.add_parser("add"); p.add_argument("slug"); p.add_argument("target"); p.add_argument("--name")
    p = sub.add_parser("reviews"); p.add_argument("slug"); p.add_argument("app_id"); p.add_argument("--pages", type=int, default=2)
    p = sub.add_parser("refresh"); p.add_argument("slug")
    p = sub.add_parser("status"); p.add_argument("slug", nargs="?")
    a = ap.parse_args(argv)
    if a.cmd == "search":
        search(a.slug, a.term, min(a.limit, 25), a.add)
    elif a.cmd == "add":
        if re.fullmatch(r"(id)?\d+", a.target):
            add_app(a.slug, a.target.removeprefix("id"))
        else:
            add_web(a.slug, a.target, a.name)
    elif a.cmd == "reviews":
        reviews(a.slug, a.app_id.removeprefix("id"), min(a.pages, 10))
    elif a.cmd == "refresh":
        refresh(a.slug)
    else:
        status(a.slug)


if __name__ == "__main__":
    sys.exit(main())
