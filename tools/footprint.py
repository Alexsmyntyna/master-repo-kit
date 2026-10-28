#!/usr/bin/env python3
"""A project's real-world footprint: where it's hosted, what database and payments it uses, which stores and domains.

Read-only on project repos. It looks at file presence and dependency names (package.json, requirements*.txt,
pyproject.toml, Podfile, Package.swift, Gemfile, go.mod), environment variable NAMES in .env.example-style files
and in code, and a few imports in Swift code. It never opens .env, .env.local or any key, credential or secret
file, and never records a value. Every detected item carries source "code" and the file it came from.

Writes companies/<slug>/footprint.json (two-space JSON). `monthly_cost` is the owner's to fill from statements; a value
already there is kept, as is any key this tool doesn't know.

Usage:
    footprint.py scan <slug> [--probe]     # one project
    footprint.py scan --all [--probe]      # every project
    --probe HEAD-requests each links.public URL in company.json (5 s timeout); without it public_urls_ok is null.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402
import safe_fs  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)

SKIP_DIRS = {".git", "node_modules", "Pods", "build", ".build", ".next", "dist", "out", "DerivedData", "vendor",
             ".venv", "venv", "env", "__pycache__", "target", "coverage", ".turbo", ".expo", "xcuserdata",
             ".swiftpm", "Carthage", ".gradle", ".idea", ".vscode", ".cache", "tmp"}
MAX_DEPTH = 4
MAX_SOURCE_FILES = 3000
MAX_SOURCE_BYTES = 300_000
# Never opened, whatever the content: env files with values, keys, certificates, credentials (AGENTS.md privacy).
PRIVATE_RE = re.compile(r"(^\.env($|\.(?!example$|sample$|template$|dist$|defaults$).*)|\.pem$|\.key$|\.p8$|\.p12$"
                        r"|\.pfx$|\.cer$|\.crt$|\.keystore$|\.jks$|\.mobileprovision$|^id_(rsa|ed25519|ecdsa)"
                        r"|secret|credential|password|token|GoogleService-Info\.plist$|google-services\.json$"
                        r"|serviceAccount|\.sqlite$|\.db$|\.csv$|\.xlsx?$)", re.I)
ENV_EXAMPLES = {".env.example", ".env.sample", ".env.template", ".env.dist", ".env.defaults", "env.example"}
SOURCE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".swift", ".rb", ".go"}
ENV_NAME_RE = re.compile(r"process\.env\.([A-Z][A-Z0-9_]{2,})|process\.env\[['\"]([A-Z][A-Z0-9_]{2,})['\"]\]"
                         r"|os\.environ(?:\.get)?\(?\[?['\"]([A-Z][A-Z0-9_]{2,})['\"]|os\.getenv\(['\"]([A-Z][A-Z0-9_]{2,})['\"]"
                         r"|ENV\[['\"]([A-Z][A-Z0-9_]{2,})['\"]\]|import\.meta\.env\.([A-Z][A-Z0-9_]{2,})")
SWIFT_IMPORTS = {"SwiftData": ("database", "swiftdata"), "CoreData": ("database", "coredata"),
                 "StoreKit": ("payments", "storekit"), "RevenueCat": ("payments", "revenuecat"),
                 "FirebaseFirestore": ("database", "firebase"), "CloudKit": ("database", "cloudkit")}
# Dependency name (exact, or prefix ending in "/") -> (category, item)
DEPS = {
    "mongoose": ("database", "mongodb"), "mongodb": ("database", "mongodb"), "pymongo": ("database", "mongodb"),
    "motor": ("database", "mongodb"), "@prisma/client": ("database", "prisma"), "prisma": ("database", "prisma"),
    "pg": ("database", "postgres"), "postgres": ("database", "postgres"), "psycopg2": ("database", "postgres"),
    "psycopg2-binary": ("database", "postgres"), "psycopg": ("database", "postgres"), "asyncpg": ("database", "postgres"),
    "@neondatabase/serverless": ("database", "postgres"), "@vercel/postgres": ("database", "postgres"),
    "mysql": ("database", "mysql"), "mysql2": ("database", "mysql"), "pymysql": ("database", "mysql"),
    "sqlite3": ("database", "sqlite"), "better-sqlite3": ("database", "sqlite"), "sqlite": ("database", "sqlite"),
    "aiosqlite": ("database", "sqlite"), "@libsql/client": ("database", "sqlite"), "drizzle-orm": ("database", "drizzle"),
    "@supabase/supabase-js": ("database", "supabase"), "supabase": ("database", "supabase"),
    "firebase": ("database", "firebase"), "firebase-admin": ("database", "firebase"),
    "redis": ("database", "redis"), "ioredis": ("database", "redis"), "@upstash/redis": ("database", "redis"),
    "sqlalchemy": ("database", "sqlalchemy"), "typeorm": ("database", "typeorm"), "sequelize": ("database", "sequelize"),
    "stripe": ("payments", "stripe"), "@stripe/stripe-js": ("payments", "stripe"), "@stripe/react-stripe-js": ("payments", "stripe"),
    "@paddle/paddle-js": ("payments", "paddle"), "@paddle/paddle-node-sdk": ("payments", "paddle"),
    "react-native-purchases": ("payments", "revenuecat"), "RevenueCat": ("payments", "revenuecat"),
    "purchases-ios": ("payments", "revenuecat"), "@lemonsqueezy/lemonsqueezy.js": ("payments", "lemonsqueezy"),
    "expo": ("store", "expo"), "electron-builder": ("store", "electron-builder"), "electron": ("store", "electron"),
    "@vercel/analytics": ("hosting", "vercel"), "@netlify/functions": ("hosting", "netlify"),
    "@aws-sdk/client-s3": ("storage", "s3-compatible"), "boto3": ("storage", "s3-compatible"),
}
ENV_HINTS = (
    (re.compile(r"^MONGO"), ("database", "mongodb")), (re.compile(r"^STRIPE_"), ("payments", "stripe")),
    (re.compile(r"^SUPABASE_|_SUPABASE_"), ("database", "supabase")), (re.compile(r"^(POSTGRES|PG)"), ("database", "postgres")),
    (re.compile(r"^(DO_|DIGITALOCEAN)|_DO_SPACES|^SPACES_"), ("hosting", "digitalocean")),
    (re.compile(r"^VERCEL"), ("hosting", "vercel")), (re.compile(r"^FLY_"), ("hosting", "fly")),
    (re.compile(r"^REDIS"), ("database", "redis")), (re.compile(r"^REVENUECAT|^RC_"), ("payments", "revenuecat")),
    (re.compile(r"^PADDLE_"), ("payments", "paddle")), (re.compile(r"^FIREBASE_"), ("database", "firebase")),
    (re.compile(r"(^|_)S3_|^AWS_S3|_SPACES_"), ("storage", "s3-compatible")),
)
EVIDENCE_PER_ITEM = 3  # a few files per detected item are enough to check it
WORKFLOW_HINTS = {"doctl": "digitalocean", "digitalocean": "digitalocean", "vercel": "vercel", "flyctl": "fly",
                  "netlify": "netlify", "render.com": "render", "gh-pages": "github-pages",
                  "actions/deploy-pages": "github-pages", "app-store-connect": "app-store", "fastlane": "fastlane"}
HOST_FILES = {"vercel.json": "vercel", "fly.toml": "fly", "netlify.toml": "netlify", "render.yaml": "render",
              "Procfile": "procfile", "eas.json": "expo-eas", "wrangler.toml": "cloudflare", "firebase.json": "firebase",
              "app.yaml": "app-yaml", "Dockerfile": "docker", "docker-compose.yml": "docker", "docker-compose.yaml": "docker",
              "compose.yml": "docker", "compose.yaml": "docker", "CNAME": "github-pages"}
PLATFORM_HOSTS = ("github.com", "instagram.com", "apps.apple.com", "itunes.apple.com", "play.google.com",
                  "linkedin.com", "twitter.com", "x.com", "youtube.com", "facebook.com", "tiktok.com", "medium.com",
                  "npmjs.com", "pypi.org", "testflight.apple.com", "notion.so", "figma.com", "drive.google.com")


def today() -> str:
    return dt.date.today().isoformat()


# ---------------------------------------------------------------- data files (shared with hygiene.py, card.py)

def all_slugs(root: Path | None = None) -> list[str]:
    root = root or ROOT
    return sorted(p.parent.name for p in (root / "companies").glob("*/company.json") if not p.parent.name.startswith("_"))


def read_json(rel: str, root: Path | None = None, default=None):
    """A JSON file under the data directory, read without following links; `default` when missing or invalid."""
    dirs, name = safe_fs.split(rel)
    try:
        dfd = safe_fs.open_dirs(root or ROOT, dirs)
    except OSError:
        return default
    try:
        return json.loads(safe_fs.read_single(name, dir_fd=dfd))
    except (OSError, ValueError):
        return default
    finally:
        os.close(dfd)


def write_json(rel: str, data, root: Path | None = None) -> None:
    dirs, name = safe_fs.split(rel)
    dfd = safe_fs.open_dirs(root or ROOT, dirs, create=True)
    try:
        safe_fs.write_at(dfd, name, (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode())
    finally:
        os.close(dfd)


def company(slug: str, root: Path | None = None) -> dict:
    return read_json(f"companies/{slug}/company.json", root, {}) or {}


def repo_paths(model: dict) -> list[Path]:
    out = []
    for r in model.get("repos") or []:
        p = r.get("path") if isinstance(r, dict) else r if isinstance(r, str) else None
        if p:
            out.append(Path(p) / r["subdir"] if isinstance(r, dict) and r.get("subdir") else Path(p))
    return out


def public_urls(model: dict) -> list[str]:
    out = []
    for item in (model.get("links") or {}).get("public") or []:
        url = item if isinstance(item, str) else (item.get("path") or item.get("url")) if isinstance(item, dict) else None
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            out.append(url)
    return out


# ---------------------------------------------------------------- scanning

def private(name: str) -> bool:
    return name not in ENV_EXAMPLES and bool(PRIVATE_RE.search(name))


def walk(repo: Path):
    """(path, is_dir) for everything under repo up to MAX_DEPTH, skipping vendored, built and private paths."""
    stack = [(repo, 0)]
    while stack:
        d, depth = stack.pop()
        try:
            entries = sorted(os.scandir(d), key=lambda e: e.name)
        except OSError:
            continue
        for e in entries:
            if e.is_symlink():
                continue
            if e.is_dir():
                if e.name in SKIP_DIRS:
                    continue
                yield Path(e.path), True
                if depth + 1 < MAX_DEPTH and not e.name.endswith((".xcodeproj", ".xcworkspace", ".xcdatamodeld", ".xcassets")):
                    stack.append((Path(e.path), depth + 1))
            elif e.is_file() and not private(e.name):
                yield Path(e.path), False


def read_text(path: Path, limit: int = MAX_SOURCE_BYTES) -> str:
    if private(path.name):  # belt and braces: nothing private is ever opened
        return ""
    try:
        with open(path, "rb") as f:
            return f.read(limit).decode("utf-8", errors="replace")
    except OSError:
        return ""


def dep_names(path: Path) -> list[str]:
    """Dependency names declared in a manifest. Names only; versions and everything else are ignored."""
    name, text = path.name, read_text(path)
    if name == "package.json":
        try:
            data = json.loads(text)
        except ValueError:
            return []
        return [k for key in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
                for k in (data.get(key) or {})]
    if name.startswith("requirements") and name.endswith(".txt"):
        return [re.split(r"[<>=!~\[; ]", ln.strip(), 1)[0].lower() for ln in text.splitlines()
                if ln.strip() and not ln.strip().startswith(("#", "-"))]
    if name == "pyproject.toml":
        return [m.lower() for m in re.findall(r"^\s*['\"]?([A-Za-z0-9_.\-]+)\s*(?:[<>=!~\[;'\"]|=\s*[{'\"])", text, re.M)]
    if name == "Podfile":
        return re.findall(r"^\s*pod\s+['\"]([^'\"/]+)", text, re.M)
    if name == "Package.swift":
        return [u.rstrip("/").split("/")[-1].removesuffix(".git") for u in re.findall(r"url:\s*\"([^\"]+)\"", text)]
    if name == "Gemfile":
        return re.findall(r"^\s*gem\s+['\"]([^'\"]+)", text, re.M)
    if name == "go.mod":
        return [m.split("/")[-1] for m in re.findall(r"^\s*(?:require\s+)?([a-z0-9.\-]+/[^\s]+)\s+v", text, re.M)]
    return []


def env_example_names(path: Path) -> list[str]:
    return [m.group(1) for m in re.finditer(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", read_text(path), re.M)]


def domain_of(url: str) -> str | None:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    if not host or "." not in host or host in ("localhost",) or re.fullmatch(r"[\d.]+", host):
        return None
    if any(host == p or host.endswith("." + p) for p in PLATFORM_HOSTS):
        return None
    return host


def scan_repo(repo: Path, found: dict[str, list], evidence: list[dict], env_names: set[str], root_label: Path) -> None:
    def add(category: str, item: str, what: str, path: Path) -> None:
        if item not in found[category]:
            found[category].append(item)
        rel = str(path)
        same = [e for e in evidence if e["category"] == category and e["item"] == item]
        if len(same) < EVIDENCE_PER_ITEM and not any(e["what"] == what and e["path"] == rel for e in same):
            evidence.append({"what": what, "category": category, "item": item, "path": rel, "source": "code"})

    sources = 0
    for path, is_dir in walk(repo):
        name = path.name
        if is_dir:
            if name.endswith(".xcodeproj"):
                add("store", "ios", f"Xcode project {name}", path)
                add("hosting", "xcode", f"Xcode project {name}", path)
            elif name.endswith(".xcdatamodeld"):
                add("database", "coredata", f"Core Data model {name}", path)
            elif name == "fastlane":
                add("hosting", "fastlane", "fastlane folder", path)
            elif name == ".do":
                add("hosting", "digitalocean", "DigitalOcean app spec folder .do/", path)
            elif name == "android" and (path / "build.gradle").exists() or name == "android" and (path / "build.gradle.kts").exists():
                add("store", "android", "android/ Gradle project", path)
            continue
        if name in HOST_FILES:
            item = HOST_FILES[name]
            if name == "app.yaml":
                text = read_text(path, 20_000)
                if path.parent.name == ".do" or re.search(r"^\s*(services|static_sites|workers):", text, re.M):
                    item = "digitalocean"
                elif re.search(r"^\s*runtime:", text, re.M):
                    item = "google-app-engine"
                else:
                    continue
            add("hosting", item, f"{name} present", path)
            if name == "CNAME":
                d = domain_of("https://" + read_text(path, 500).strip().splitlines()[0]) if read_text(path, 500).strip() else None
                if d:
                    add("domains", d, f"CNAME names {d}", path)
            continue
        if name in ("package.json", "Podfile", "Package.swift", "Gemfile", "go.mod", "pyproject.toml") or \
                (name.startswith("requirements") and name.endswith(".txt")):
            for dep in dep_names(path):
                hit = DEPS.get(dep) or DEPS.get(dep.lower())
                if hit:
                    add(hit[0], hit[1], f"dependency {dep}", path)
            if name == "package.json":
                try:
                    homepage = json.loads(read_text(path)).get("homepage")
                except (ValueError, AttributeError):
                    homepage = None
                d = domain_of(homepage) if isinstance(homepage, str) else None
                if d:
                    add("domains", d, f"package.json homepage {d}", path)
            continue
        if name == "schema.prisma":
            m = re.search(r"datasource\s+\w+\s*\{[^}]*provider\s*=\s*\"(\w+)\"", read_text(path, 50_000), re.S)
            if m:
                add("database", {"postgresql": "postgres", "mongodb": "mongodb"}.get(m.group(1), m.group(1)),
                    f"Prisma datasource provider {m.group(1)}", path)
            continue
        if name in ENV_EXAMPLES:
            for n in env_example_names(path):
                env_names.add(n)
                for rx, (cat, item) in ENV_HINTS:
                    if rx.search(n):
                        add(cat, item, f"env name {n} in {name}", path)
            continue
        if name.startswith("next.config."):
            m = re.search(r"(?:siteUrl|metadataBase[^\"'`]*)[\"'`(:\s]+[\"'`](https?://[^\"'`]+)", read_text(path, 50_000))
            d = domain_of(m.group(1)) if m else None
            if d:
                add("domains", d, f"next.config site URL {d}", path)
            continue
        if path.parent.name == "workflows" and path.parent.parent.name == ".github" and name.endswith((".yml", ".yaml")):
            text = read_text(path, 100_000).lower()
            for needle, item in WORKFLOW_HINTS.items():
                if needle in text:
                    add("hosting", item, f"workflow mentions {needle}", path)
            continue
        if path.suffix in SOURCE_EXT and sources < MAX_SOURCE_FILES:
            sources += 1
            text = read_text(path)
            for m in ENV_NAME_RE.finditer(text):
                n = next(g for g in m.groups() if g)
                env_names.add(n)
                for rx, (cat, item) in ENV_HINTS:
                    if rx.search(n):
                        add(cat, item, f"env name {n} read in code", path)
            if path.suffix == ".swift":
                for mod in re.findall(r"^\s*import\s+(\w+)", text, re.M):
                    if mod in SWIFT_IMPORTS:
                        cat, item = SWIFT_IMPORTS[mod]
                        add(cat, item, f"import {mod}", path)


def probe(url: str, timeout: float = 5.0) -> dict:
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "master-repo-footprint/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = resp.status
    except urllib.error.HTTPError as e:
        status = e.code
    except (urllib.error.URLError, OSError, ValueError) as e:
        return {"url": url, "status": None, "ok": False, "error": str(getattr(e, "reason", e))[:120]}
    return {"url": url, "status": status, "ok": 200 <= status < 400 or status == 405}


NAMES = {"digitalocean": "DigitalOcean", "mongodb": "MongoDB", "postgres": "Postgres", "vercel": "Vercel",
         "stripe": "Stripe", "storekit": "StoreKit", "revenuecat": "RevenueCat", "swiftdata": "SwiftData",
         "coredata": "Core Data", "github-pages": "GitHub Pages", "supabase": "Supabase", "firebase": "Firebase",
         "sqlite": "SQLite", "cloudkit": "CloudKit", "s3-compatible": "S3 storage", "ios": "iOS app", "android": "Android app", "fly": "Fly.io", "netlify": "Netlify",
         "docker": "Docker", "expo": "Expo", "prisma": "Prisma", "redis": "Redis", "mysql": "MySQL"}


def summary(fp: dict) -> str:
    # The hosting line names where it runs; build-only signals (xcode, docker, procfile) say less than a platform.
    hosting = [h for h in fp["hosting"] if h not in ("xcode", "docker", "procfile", "fastlane", "app-yaml")] or \
        [h for h in fp["hosting"] if h in ("docker",)]
    parts = [NAMES.get(x, x) for x in hosting + fp["database"] + fp.get("storage", []) + fp["payments"]]
    if "ios" in fp["store"] and "ios" not in parts:
        parts.append(NAMES["ios"])
    if not parts:
        return "nothing hosted, stored or billed found in code"
    cost = fp.get("monthly_cost")
    return " + ".join(dict.fromkeys(parts)) + ("; cost unknown" if cost in (None, "") else f"; {cost}/mo")


def scan(slug: str, do_probe: bool = False, root: Path | None = None) -> dict:
    root = root or ROOT
    model = company(slug, root)
    rel = f"companies/{slug}/footprint.json"
    old = read_json(rel, root, {}) or {}
    found: dict[str, list] = {k: [] for k in ("hosting", "database", "payments", "store", "storage", "domains")}
    evidence: list[dict] = []
    env_names: set[str] = set()
    repos, warnings = [], []
    for repo in repo_paths(model):
        if not repo.is_dir():
            warnings.append(f"repo not found: {repo}")
            continue
        repos.append(str(repo))
        scan_repo(repo, found, evidence, env_names, repo)
    urls = public_urls(model)
    for url in urls:
        d = domain_of(url)
        if d and d not in found["domains"]:
            found["domains"].append(d)
            evidence.append({"what": f"links.public {url}", "category": "domains", "item": d,
                             "path": f"companies/{slug}/company.json", "source": "owner"})
    probes = [probe(u) for u in urls] if do_probe else None
    fp = dict(old)
    fp.update({"slug": slug, **found, "env_names": sorted(env_names),
               "public_urls_ok": (all(p["ok"] for p in probes) if probes else None) if do_probe else None,
               "monthly_cost": old.get("monthly_cost"), "evidence": evidence, "repos": repos,
               "scanned_at": today()})
    if do_probe:
        fp["probes"] = probes
    elif "probes" in fp:
        fp.pop("probes")
    if warnings:
        fp["warnings"] = warnings
    else:
        fp.pop("warnings", None)
    fp["summary"] = summary(fp)
    write_json(rel, fp, root)
    return fp


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("scan", help="write companies/<slug>/footprint.json from a read-only scan of its repos")
    s.add_argument("slug", nargs="?")
    s.add_argument("--all", action="store_true", help="every project")
    s.add_argument("--probe", action="store_true", help="HEAD-request links.public URLs (5 s timeout)")
    a = p.parse_args(argv)
    if bool(a.slug) == a.all:
        p.error("give a slug or --all")
    slugs = all_slugs() if a.all else [a.slug]
    if not a.all and not (ROOT / "companies" / a.slug / "company.json").is_file():
        p.error(f"no companies/{a.slug}/company.json")
    for slug in slugs:
        fp = scan(slug, a.probe)
        note = f"  ({'; '.join(fp['warnings'])})" if fp.get("warnings") else ""
        print(f"{slug:22} {fp['summary']}{note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
