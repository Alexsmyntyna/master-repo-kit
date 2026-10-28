#!/usr/bin/env python3
"""Screens: what every project looks like right now, for the owner and for agents.

Each project that has screens gets `companies/<slug>/screens/screens.json` (agents write and maintain it). Anything
that runs a command or reads outside the repo lives in `capture.json` next to it, which only the owner edits (agents
can't write it): `adapter: "delegate"`, `delegate` and `inventory_file`. Those keys are ignored in screens.json.


    {
      "adapter": "web" | "delegate",
      "inventory": [ {"id": "billing", "title": "Billing", "surfaces": [
          {"id": "billing.invoices", "title": "Invoice list", "route": "/invoices", "states": ["empty", "overdue"],
           "source": "src/app/invoices/page.tsx"} ]} ],
      "inventory_file": "/abs/path/to/app_frontend_inventory.json",   # optional: read the features from the project
      "web": {"base_url": "http://127.0.0.1:3000", "viewports": [[1440, 1000], [390, 844]]},
      "delegate": {"runs": "/abs/path/to/artifacts/screenshots", "command": ["python3", "tools/app_screenshots.py", "--missing", "--apply"]},
      "review": "What a good screen looks like for this project, in a few lines (the analysis agent reads it)."
    }

Adapters:
  web       Master-Repo captures each surface's route with headless Chrome into companies/<slug>/screens/runs/run-NNNN/.
  delegate  The project has its own capture pipeline (ReaderApp's iOS simulator runner). `capture` runs its command in
            the project repo; `sync` reads its run manifests (manifest.json with captures[].screen/file/position).

Everything ends up in companies/<slug>/screens/latest.json (newest capture per surface and frame, generated) and
notes.json (per-screen notes with revisions, kept in git). The PNGs stay out of git.

Usage:
    screens.py status                                  # every project: surfaces, captured, open issues
    screens.py sync <slug>                             # rebuild latest.json from the runs
    screens.py capture <slug> [--surfaces a b] [--apply]   # dry run unless --apply
    screens.py analyze <slug> [--surfaces a b] [--model sonnet] [--apply]   # an agent reviews the latest captures
    screens.py note <slug> --surface ID --severity issue|needs-evaluation|suggestion --text "..." [--capture PATH] [--author agent]
    screens.py resolve <slug> --note ID --text "..." [--capture PATH] [--author NAME]
    screens.py issues <slug> [--status open] [--json]
    screens.py query <slug> --surface ID [--json]       # inventory entry, latest frames and notes for one screen
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402

ROOT = paths.ROOT  # the data directory (MASTER_REPO_ROOT, or this checkout)
SEVERITIES = ("issue", "needs-evaluation", "suggestion")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def now() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def project_dir(slug: str) -> Path:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug) or not (ROOT / "companies" / slug / "company.json").exists():
        raise SystemExit(f"Unknown project: {slug}")
    return ROOT / "companies" / slug


def screens_dir(slug: str) -> Path:
    return project_dir(slug) / "screens"


TRUSTED_KEYS = ("delegate", "inventory_file")  # only honoured from capture.json, which agents cannot write


def load_config(slug: str) -> dict:
    path = screens_dir(slug) / "screens.json"
    if not path.exists():
        raise SystemExit(f"No screens.json for {slug}. An agent writes it: see skills/screens.md.")
    config = {k: v for k, v in json.loads(path.read_text()).items() if k not in TRUSTED_KEYS}
    trusted = screens_dir(slug) / "capture.json"
    if trusted.exists():
        config.update({k: v for k, v in json.loads(trusted.read_text()).items() if k in (*TRUSTED_KEYS, "adapter")})
    elif config.get("adapter") == "delegate":
        config["adapter"] = "delegate (needs capture.json)"
    return config


def inventory(config: dict) -> list[dict]:
    """Features with their surfaces, from screens.json or the project's own inventory file."""
    features = list(config.get("inventory") or [])
    if config.get("inventory_file") and Path(config["inventory_file"]).exists():
        data = json.loads(Path(config["inventory_file"]).read_text())
        features += data.get("features") or []
    return features


def surfaces(config: dict) -> dict[str, dict]:
    return {s["id"]: {**s, "feature": f.get("id")} for f in inventory(config) for s in f.get("surfaces") or []}


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(path)


# --- runs and latest ---------------------------------------------------------------------------------

def run_dirs(slug: str, config: dict) -> list[Path]:
    roots = [screens_dir(slug) / "runs"]
    if config.get("adapter") == "delegate" and (config.get("delegate") or {}).get("runs"):
        roots.append(Path(config["delegate"]["runs"]))
    return sorted((d for r in roots if r.is_dir() for d in r.iterdir() if (d / "manifest.json").exists()),
                  key=lambda d: d.name)


def capture_owner(capture_id: str, owners: dict[str, str], known: dict[str, dict]) -> str | None:
    """Map a captured screen id to an inventory surface (directly, or through a surface's captureIds)."""
    if capture_id in known:
        return capture_id
    return owners.get(capture_id)


def sync(slug: str) -> dict:
    """Newest successful frame per surface and position, across every retained run."""
    config = load_config(slug)
    known = surfaces(config)
    owners = {cid: sid for sid, s in known.items() for cid in s.get("captureIds") or []}
    latest: dict[str, dict] = {}
    runs = []
    for d in run_dirs(slug, config):
        try:
            m = json.loads((d / "manifest.json").read_text())
        except ValueError:
            continue
        finished = m.get("finishedAt") or m.get("startedAt") or ""
        runs.append({"run": d.name, "path": str(d), "status": m.get("status"), "finished": finished,
                     "captures": len(m.get("captures") or []), "commit": m.get("sourceCommit"),
                     "config": {k: m.get(k) for k in ("platform", "scenario", "theme", "textSize", "viewport") if m.get(k)}})
        for c in m.get("captures") or []:
            if c.get("status", "captured") != "captured" or not c.get("file"):
                continue
            image = d / c["file"]
            if not image.exists():
                continue
            sid = capture_owner(c.get("screen", ""), owners, known) or c.get("screen")
            frames = latest.setdefault(sid, {"surface": sid, "known": sid in known, "frames": {}})
            position = c.get("position") or "top"
            prev = frames["frames"].get(position)
            if not prev or prev["finished"] <= finished:
                frames["frames"][position] = {
                    "image": str(image), "run": d.name, "finished": finished, "capture": c.get("screen"),
                    "text": str(d / c["accessibilityTextFile"]) if c.get("accessibilityTextFile") else None,
                    "config": {k: m.get(k) for k in ("platform", "scenario", "theme", "textSize", "viewport") if m.get(k)},
                }
    for entry in latest.values():
        entry["updated"] = max(f["finished"] for f in entry["frames"].values())
    data = {"generated": now(), "adapter": config.get("adapter"), "runs": runs[-50:], "surfaces": latest}
    write_json(screens_dir(slug) / "latest.json", data)
    return data


def next_run(slug: str) -> Path:
    base = screens_dir(slug) / "runs"
    base.mkdir(parents=True, exist_ok=True)
    n = max([int(d.name.split("-")[1]) for d in base.glob("run-*") if d.name.split("-")[1].isdigit()] or [0]) + 1
    return base / f"run-{n:04d}"


def capture_web(slug: str, config: dict, picks: list[dict]) -> Path:
    web = config.get("web") or {}
    base = (web.get("base_url") or "").rstrip("/")
    if not re.match(r"https?://(127\.0\.0\.1|localhost)(:\d+)?$", base):
        raise SystemExit("web.base_url must be a local dev server (http://127.0.0.1:PORT or http://localhost:PORT).")
    run = next_run(slug)
    (run / "screens").mkdir(parents=True)
    started, captures = now(), []
    for s in picks:
        for w, h in web.get("viewports") or [[1440, 1000]]:
            name = f"{s['id']}.{w}x{h}.png"
            url = base + (s.get("route") or "/")
            proc = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                                   "--virtual-time-budget=4000", f"--window-size={w},{h}",
                                   f"--screenshot={run / 'screens' / name}", url],
                                  capture_output=True, text=True, timeout=120)
            ok = (run / "screens" / name).exists()
            captures.append({"screen": s["id"], "file": f"screens/{name}", "position": f"{w}x{h}",
                             "status": "captured" if ok else "failed", "url": url,
                             **({} if ok else {"error": proc.stderr[-300:]})})
    status = "passed" if all(c["status"] == "captured" for c in captures) else "failed"
    write_json(run / "manifest.json", {"status": status, "platform": "web", "startedAt": started, "finishedAt": now(),
                                       "baseUrl": base, "captures": captures})
    return run


def capture(slug: str, surface_ids: list[str] | None, apply: bool) -> str:
    config = load_config(slug)
    known = surfaces(config)
    picks = [known[i] for i in surface_ids] if surface_ids else [s for s in known.values() if s.get("route")]
    missing = [i for i in surface_ids or [] if i not in known]
    if missing:
        raise SystemExit(f"Not in the inventory: {', '.join(missing)}")
    adapter = config.get("adapter")
    if adapter == "web":
        plan = f"web: {len(picks)} surfaces × {len((config.get('web') or {}).get('viewports') or [1])} viewports from {(config.get('web') or {}).get('base_url')}"
        if not apply:
            return "Dry run. " + plan
        run = capture_web(slug, config, picks)
        sync(slug)
        return f"{run.relative_to(ROOT)}: {json.loads((run / 'manifest.json').read_text())['status']}"
    if adapter == "delegate":
        d = config.get("delegate") or {}
        repo = json.loads((project_dir(slug) / "company.json").read_text())["repos"][0]["path"]
        cmd = list(d.get("command") or [])
        if surface_ids:
            cmd += ["--screens", *surface_ids] if "--missing" not in cmd else []
        if not cmd:
            raise SystemExit("delegate.command is empty")
        if not apply:
            return f"Dry run. Would run in {repo}: {' '.join(cmd)}"
        proc = subprocess.run(cmd, cwd=repo, capture_output=True, text=True, timeout=7200)
        sync(slug)
        return f"exit {proc.returncode}\n{proc.stdout[-2000:]}{proc.stderr[-1000:]}"
    raise SystemExit(f"Unknown adapter: {adapter}")


# --- notes -------------------------------------------------------------------------------------------

def notes_path(slug: str) -> Path:
    return screens_dir(slug) / "notes.json"


def load_notes(slug: str) -> list[dict]:
    p = notes_path(slug)
    return json.loads(p.read_text()).get("notes", []) if p.exists() else []


def save_notes(slug: str, notes: list[dict]) -> None:
    write_json(notes_path(slug), {"notes": notes})


def add_note(slug: str, surface: str, severity: str, text: str, capture: str | None = None,
             author: str = "agent") -> dict:
    if severity not in SEVERITIES:
        raise SystemExit(f"Severity is one of {', '.join(SEVERITIES)}")
    if not text.strip():
        raise SystemExit("Empty note")
    known = surfaces(load_config(slug))
    if surface not in known and surface not in (json.loads((screens_dir(slug) / "latest.json").read_text())["surfaces"]
                                               if (screens_dir(slug) / "latest.json").exists() else {}):
        raise SystemExit(f"Unknown surface: {surface}")
    note = {"id": uuid.uuid4().hex[:10], "surface": surface, "severity": severity, "status": "open",
            "revisions": [{"at": now(), "author": "owner" if author == "alex" else author, "text": text.strip(), "capture": capture}]}
    notes = load_notes(slug)
    notes.append(note)
    save_notes(slug, notes)
    return note


def resolve_note(slug: str, note_id: str, text: str, capture: str | None = None, author: str = "owner") -> dict:
    notes = load_notes(slug)
    hits = [n for n in notes if n["id"].startswith(note_id)]
    if len(hits) != 1:
        raise SystemExit("No single note matches that id")
    hits[0]["status"] = "resolved"
    hits[0]["revisions"].append({"at": now(), "author": "owner" if author == "alex" else author, "text": text.strip() or "Resolved.", "capture": capture})
    save_notes(slug, notes)
    return hits[0]


# --- analysis ----------------------------------------------------------------------------------------

def analysis_prompt(slug: str, config: dict, entries: list[tuple[dict, dict]]) -> str:
    vision = ROOT / "holding" / "vision.md"
    company = json.loads((project_dir(slug) / "company.json").read_text())
    lines = [f"You review the screens of {company.get('name', slug)}, one of the owner's apps, as a sharp product designer.",
             "Look at each screenshot with the Read tool (it shows images). Judge it against the project's review "
             "guidance and the owner's vision: simple and smooth on first use, depth over time, care for the experience.",
             "Report only concrete, visible problems or clear improvements: layout breaks, clipped or overlapping text, "
             "inconsistent spacing or type, confusing hierarchy, empty states that explain nothing, accessibility "
             "(contrast, tiny targets). No praise, no generic advice. Say needs-evaluation when unsure.", ""]
    if config.get("review"):
        lines += ["## Review guidance for this project", config["review"], ""]
    if vision.exists():
        lines += ["## the owner's vision (excerpt)", vision.read_text()[:1500], ""]
    lines.append("## Screens")
    for s, e in entries:
        lines.append(f"- `{s['id']}` {s.get('title', '')}" + (f" (states: {', '.join(s.get('states', [])[:6])})" if s.get("states") else ""))
        for pos, f in sorted(e["frames"].items()):
            lines.append(f"  - {pos}: {f['image']}")
    lines += ["", "Output only a JSON array, nothing else. Each item: "
              '{"surface": "<id>", "severity": "issue|needs-evaluation|suggestion", "capture": "<image path>", '
              '"text": "<one or two sentences: what is wrong and the fix>"}. An empty array is fine.']
    return "\n".join(lines)


def analyze(slug: str, surface_ids: list[str] | None, model: str, apply: bool, batch: int = 8) -> str:
    sys.path.insert(0, str(Path(__file__).parent))
    import converse
    config = load_config(slug)
    known = surfaces(config)
    latest = sync(slug)["surfaces"]
    ids = surface_ids or [i for i in latest if i in known]
    entries = [(known.get(i, {"id": i}), latest[i]) for i in ids if i in latest]
    if not entries:
        return "Nothing captured to review."
    if not apply:
        return f"Dry run. Would review {len(entries)} screens in {-(-len(entries) // batch)} agent runs ({model})."
    dirs = sorted({str(Path(f["image"]).parent) for _, e in entries for f in e["frames"].values()})
    added = 0
    for start in range(0, len(entries), batch):
        chunk = entries[start:start + batch]
        cmd = ["claude", "-p", "--model", model, "--output-format", "json", "--no-session-persistence",
               "--max-turns", str(4 + 3 * len(chunk)), "--settings", json.dumps({"disableAllHooks": True}),
               "--strict-mcp-config", "--allowedTools", "Read"]
        for d in dirs:
            cmd += ["--add-dir", d]
        began = dt.datetime.now()
        proc = subprocess.run(cmd, input=analysis_prompt(slug, config, chunk), capture_output=True, text=True,
                              cwd=ROOT, env=converse.subscription_env())
        entry = {"thread": "", "scope": slug, "role": "coo", "engine": "claude", "model": model,
                 "started": began.isoformat(timespec="seconds"), "task": "screens-review",
                 "seconds": round((dt.datetime.now() - began).total_seconds())}
        try:
            data = json.loads(proc.stdout)
            found = json.loads(re.search(r"\[.*\]", data.get("result") or "", re.S).group(0))
        except (ValueError, AttributeError) as error:
            converse.log_run({**entry, "ok": False, "error": f"{error}: {proc.stderr[-300:]}"})
            continue
        converse.log_run({**entry, "ok": True, "turns": data.get("num_turns"),
                          "list_price_usd": round(data.get("total_cost_usd") or 0, 4)})
        for item in found:
            if item.get("surface") in {s["id"] for s, _ in chunk} and item.get("severity") in SEVERITIES:
                add_note(slug, item["surface"], item["severity"], str(item.get("text", ""))[:1000],
                         item.get("capture"), author=f"agent ({model})")
                added += 1
    return f"Reviewed {len(entries)} screens; {added} notes added."


# --- commands ----------------------------------------------------------------------------------------

def status_rows() -> list[dict]:
    rows = []
    for d in sorted((ROOT / "companies").glob("*/screens/screens.json")):
        slug = d.parent.parent.name
        config = load_config(slug)
        known = surfaces(config)
        latest_path = d.parent / "latest.json"
        latest = json.loads(latest_path.read_text())["surfaces"] if latest_path.exists() else {}
        notes = load_notes(slug)
        rows.append({"slug": slug, "adapter": config.get("adapter"), "surfaces": len(known),
                     "captured": sum(1 for i in known if i in latest),
                     "open": sum(1 for n in notes if n["status"] == "open")})
    return rows


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("sync").add_argument("slug")
    for name in ("capture", "analyze"):
        p = sub.add_parser(name); p.add_argument("slug"); p.add_argument("--surfaces", nargs="+")
        p.add_argument("--apply", action="store_true")
        if name == "analyze":
            p.add_argument("--model", default="sonnet")
    p = sub.add_parser("note"); p.add_argument("slug"); p.add_argument("--surface", required=True)
    p.add_argument("--severity", required=True, choices=SEVERITIES); p.add_argument("--text", required=True)
    p.add_argument("--capture"); p.add_argument("--author", default="agent")
    p = sub.add_parser("resolve"); p.add_argument("slug"); p.add_argument("--note", required=True)
    p.add_argument("--text", default="Resolved."); p.add_argument("--capture"); p.add_argument("--author", default="owner")
    p = sub.add_parser("issues"); p.add_argument("slug"); p.add_argument("--status", default="open")
    p.add_argument("--json", action="store_true")
    p = sub.add_parser("query"); p.add_argument("slug"); p.add_argument("--surface", required=True)
    p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    if a.cmd == "status":
        for r in status_rows():
            print(f"{r['slug']:22} {r['adapter']:9} {r['captured']}/{r['surfaces']} captured · {r['open']} open notes")
    elif a.cmd == "sync":
        data = sync(a.slug)
        print(f"{len(data['surfaces'])} surfaces with captures from {len(data['runs'])} runs")
    elif a.cmd == "capture":
        print(capture(a.slug, a.surfaces, a.apply))
    elif a.cmd == "analyze":
        print(analyze(a.slug, a.surfaces, a.model, a.apply))
    elif a.cmd == "note":
        print(add_note(a.slug, a.surface, a.severity, a.text, a.capture, a.author)["id"])
    elif a.cmd == "resolve":
        print(resolve_note(a.slug, a.note, a.text, a.capture, a.author)["status"])
    elif a.cmd == "issues":
        notes = [n for n in load_notes(a.slug) if a.status == "all" or n["status"] == a.status]
        if a.json:
            print(json.dumps(notes, indent=2))
        for n in [] if a.json else notes:
            print(f"{n['id']} {n['severity']:16} {n['surface']:30} {n['revisions'][-1]['text'][:90]}")
    elif a.cmd == "query":
        config = load_config(a.slug)
        latest_path = screens_dir(a.slug) / "latest.json"
        latest = json.loads(latest_path.read_text())["surfaces"] if latest_path.exists() else {}
        out = {"surface": surfaces(config).get(a.surface), "latest": latest.get(a.surface),
               "notes": [n for n in load_notes(a.slug) if n["surface"] == a.surface]}
        print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
