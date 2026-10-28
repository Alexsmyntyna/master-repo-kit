#!/usr/bin/env python3
"""the owner's calendar (holding/calendar.json) for agents: read it, brief it, add to it.

The app's /calendar page edits the same file (app/src/lib/calendar.ts); the rules here mirror it: `due` happens on a
date, `block` is planned work with HH:MM `time`/`end`, `check` comes round every `cadence` after `last_done`. Projects
gone quiet and booked check-ins aren't stored; both sides derive them from holding/pulse.json (pulse_items here,
pulseItems there; keep the two in step).

Auto work (`auto: true`) isn't pinned to a time: schedule() places it into free work-day time from its date (or
today), rolling whatever isn't done to the next day with room; `spread` caps it at one step's time a day. A due or
block entry is done when marked `done` or when every step is ticked.

Named agenda.py, not calendar.py: tools/ is on sys.path when a tool runs, and a calendar.py would shadow the stdlib.

    agenda.py list [--from D] [--to D] [--json]          # everything between two days (default: this week)
    agenda.py brief [--day D | --week D]                 # a brief the chat dock draws (```stats, ```flow)
    agenda.py --by <thread> add --title T [--kind block|due|check] [--date D] [--time HH:MM] [--end HH:MM]
              [--cadence weekly|monthly|quarterly] [--project slug] [--about …] [--note …] [--step …]…
              [--link "label=https://…"]… [--quote "the owner's words"]
    agenda.py --by <thread> move <id> [--date D] [--time HH:MM] [--end HH:MM]
              [--auto [--spread] [--hours H]]                 # auto: scheduled into free work-day time for the owner
    agenda.py --by <thread> workday [--start HH:MM] [--end HH:MM] [--late HH:MM] [--days 0,1,…,6]
              [--routine "Title|0,6|HH:MM|HH:MM"]… [--no-routine]    # the owner's hours, and what fills them every week
    agenda.py --by <thread> done <id> [--undo]           # a check done today, or a due/block entry done (or reopened)
    agenda.py --by <thread> step <id> <step-id> [--undo]
    agenda.py --by <thread> rename <id> [--title T] [--type T]   # retitle (the id stays) or set the work type
              (types: photo selling client build check personal; "" clears, so it follows the project)
    agenda.py --by <thread> remove <id>                  # only entries an agent added

Writes need --by (the thread they come from), recorded as the entry's source. A chat agent's run is pinned to its
own thread (MASTER_REPO_CHAT, set by converse.py), so it can't write in another thread's name.
"""
from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paths  # noqa: E402

ROOT = paths.ROOT
CHAT_PIN = "MASTER_REPO_CHAT"
KINDS = ("block", "due", "check")
CADENCES = ("weekly", "monthly", "quarterly")
TYPES = ("photo", "selling", "client", "build", "check", "personal")  # the app's WORK_TYPES, less the derived routine
FIELDS = ("id", "title", "kind", "date", "time", "end", "cadence", "last_done", "project", "about", "links", "note",
          "steps", "auto", "spread", "hours", "done", "done_on", "source")
WORKDAY = {"start": "09:00", "end": "17:00", "late": "21:00", "days": [1, 2, 3, 4, 5], "routine": []}  # 0 Sunday … 6 Saturday
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
CLOCK = re.compile(r"([01]\d|2[0-3]):[0-5]\d")
WEEKDAY = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def cal_file() -> Path:
    return ROOT / "holding" / "calendar.json"


def load() -> dict:
    try:
        data = json.loads(cal_file().read_text())
    except FileNotFoundError:
        data = {}
    data.setdefault("entries", [])
    return data


def save(data: dict, today: str) -> None:
    """Same formatting as the app (JSON.stringify(raw, null, 2)): two spaces, non-ASCII kept, a newline at the end."""
    data["updated"] = today
    f = cal_file()
    tmp = f.with_name(f"{f.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, f)


def today_local() -> str:
    return dt.date.today().isoformat()


def valid_day(v: str | None) -> str | None:
    if not v or not DAY.fullmatch(v):
        return None
    try:
        d = dt.date.fromisoformat(v)
    except ValueError:
        return None
    return v if 2000 <= d.year <= 2100 else None


def clock(v: str | None) -> str | None:
    return v if v and CLOCK.fullmatch(v) else None


def add_days(d: str, n: int) -> str:
    return (dt.date.fromisoformat(d) + dt.timedelta(days=n)).isoformat()


def add_cadence(d: str, cadence: str) -> str:
    if cadence == "weekly":
        return add_days(d, 7)
    t = dt.date.fromisoformat(d)
    months = 1 if cadence == "monthly" else 3
    y, m = divmod(t.month - 1 + months, 12)
    y, m = t.year + y, m + 1
    return dt.date(y, m, min(t.day, calendar.monthrange(y, m)[1])).isoformat()  # Jan 31 + 1 month is Feb 28/29


def week_start(d: str) -> str:
    return add_days(d, -dt.date.fromisoformat(d).weekday())


def slug(text: str, limit: int = 40) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit].rstrip("-")
    return s or "item"


def fresh_id(title: str, date: str | None, taken: set[str]) -> str:
    base = slug(title)
    for c in (base, f"{base}-{date}" if date else None):
        if c and c not in taken:
            return c
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"


def next_date(e: dict, today: str) -> str | None:
    if e.get("kind") != "check":
        return valid_day(e.get("date"))
    if e.get("cadence") not in CADENCES:
        return None
    return add_cadence(e["last_done"], e["cadence"]) if valid_day(e.get("last_done")) else today


def names() -> dict[str, str]:
    out = {}
    for f in sorted((ROOT / "companies").glob("*/company.json")):
        try:
            out[f.parent.name] = json.loads(f.read_text()).get("name") or f.parent.name
        except (OSError, ValueError):
            pass
    return out


def pulse_items(today: str) -> list[dict]:
    """Mirrors pulseItems in app/src/lib/calendar.ts: a booked check-in on its day; else a focus/maintain project
    that has gone cooling or dormant, today."""
    try:
        rows = json.loads((ROOT / "holding" / "pulse.json").read_text()).get("projects") or []
    except (OSError, ValueError):
        return []
    out = []
    for p in rows:
        detail = " · ".join(x for x in (f"{p['idle_days']} days since a commit" if p.get("idle_days") is not None else "",
                                        f"{p['uncommitted']} uncommitted" if p.get("uncommitted") else "") if x)
        base = {"kind": "check", "from": "pulse", "project": p.get("slug"), "note": detail, "id": f"pulse:{p.get('slug')}"}
        if valid_day(p.get("next_check")):
            out.append({**base, "title": "Check-in", "when": p["next_check"]})
        elif p.get("tier") in ("focus", "maintain") and p.get("state") in ("cooling", "dormant"):
            out.append({**base, "title": "Gone quiet", "when": today})
    return out


def is_done(e: dict) -> bool:
    steps = e.get("steps") or []
    return e.get("done") is True or (bool(steps) and all(s.get("done") for s in steps))


def is_auto(e: dict) -> bool:
    return e.get("auto") is True and e.get("kind") != "check"


def pinned(e: dict, today: str) -> bool:
    """Mirrors pinned(): auto work given a time stays there for that day; once the day passes it's suggested again."""
    d = valid_day(e.get("date"))
    return is_auto(e) and bool(clock(e.get("time"))) and bool(d) and d >= today


def hours_of(v) -> float | None:
    return round(v * 4) / 4 if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v <= 200 else None


def days_of(v) -> list[int]:
    return sorted({d for d in v or [] if isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6})


def routine_of(v) -> list[dict]:
    out = []
    for r in v if isinstance(v, list) else []:
        r = r if isinstance(r, dict) else {}
        title, start, end, days = (r.get("title") or "").strip(), clock(r.get("start")), clock(r.get("end")), days_of(r.get("days"))
        if title and start and end and end > start and days:
            out.append({"title": title[:80], "days": days, "start": start, "end": end})
    return out


def routine_on(w: dict, d: str) -> list[dict]:
    dow = (dt.date.fromisoformat(d).weekday() + 1) % 7
    return [r for r in w["routine"] if dow in r["days"]]


def workday(data: dict) -> dict:
    w = data.get("workday") if isinstance(data.get("workday"), dict) else {}
    start, end = clock(w.get("start")) or WORKDAY["start"], clock(w.get("end")) or WORKDAY["end"]
    late = clock(w.get("late")) or max(end, WORKDAY["late"])
    days, routine = days_of(w.get("days")), routine_of(w.get("routine"))
    if end > start and late >= end:
        return {"start": start, "end": end, "late": late, "days": days or WORKDAY["days"], "routine": routine}
    return {**WORKDAY, "routine": routine}


def step_time(e: dict) -> float:
    h = hours_of(e.get("hours"))
    return h * 60 / max(len(e.get("steps") or []), 1) if h else 60


def work_left(e: dict) -> int:
    """Mirrors workLeft: hours shared across the steps (an hour a step without hours), open steps only."""
    open_ = sum(1 for s in e.get("steps") or [] if not s.get("done"))
    return max(15, round(step_time(e) * max(open_, 1) / 15) * 15)


def free_time(busy: list[tuple[int, int]], start: int, end: int, least: int) -> list[tuple[int, int]]:
    out, at = [], start
    for a, b in sorted(busy):
        if min(a, end) - at >= least:
            out.append((at, min(a, end)))
        at = max(at, b)
        if at >= end:
            break
    if end - at >= least:
        out.append((at, end))
    return out


def schedule(data: dict, today: str, now: int, horizon: int = 90) -> dict[str, list[tuple[str, int, int]]]:
    """Mirrors schedule() in app/src/lib/calendar.ts: unfinished auto work, by start day then file order, takes free
    work-day time around timed entries from its start day on (a step's time a day at most when spread); leftovers
    roll to the next work day with room. Timed entries inside the work hours push the day past `end` by as long as
    they take, up to `late`. (day, start, end) slots in minutes, worked out on every read."""
    w = workday(data)
    w0, w1 = minutes(w["start"]), minutes(w["end"])
    busy: dict[str, list[tuple[int, int]]] = {}
    for e in data["entries"]:
        d, t = valid_day(e.get("date")), clock(e.get("time"))
        if e.get("kind") != "check" and (not is_auto(e) or pinned(e, today)) and not is_done(e) and d and d >= today and t:
            busy.setdefault(d, []).append((minutes(t), minutes(clock(e.get("end"))) if clock(e.get("end")) else minutes(t) + 30))
    late = minutes(w["late"])
    day_end = {d: min(late, w1 + (w1 - w0) - sum(b - a for a, b in free_time(lst, w0, w1, 1))) for d, lst in busy.items()}
    queue = []
    for n, e in enumerate(data["entries"]):
        if is_auto(e) and not is_done(e) and not pinned(e, today):
            d = valid_day(e.get("date"))
            queue.append((d or today, n, max(d or today, today), e))
    out: dict[str, list[tuple[str, int, int]]] = {}
    for _, _, start_day, e in sorted(queue, key=lambda q: (q[0], q[1])):
        left = work_left(e)
        cap = max(30, round(step_time(e) / 15) * 15) if e.get("spread") is True else 10 ** 9
        slots, d = [], start_day
        for _ in range(horizon):
            if left <= 0:
                break
            if (dt.date.fromisoformat(d).weekday() + 1) % 7 in w["days"]:
                room = cap
                first = max(w0, -(-now // 15) * 15) if d == today else w0
                fixed = busy.get(d, []) + [(minutes(r["start"]), minutes(r["end"])) for r in routine_on(w, d)]
                for a, b in free_time(fixed, first, day_end.get(d, w1), 30):
                    if e.get("spread") is True and b - a < min(room, left):
                        continue  # spread work is a whole step in one sitting
                    stop = min(b, a + left, a + room)
                    slots.append((d, a, stop))
                    busy.setdefault(d, []).append((a, stop))
                    left, room = left - (stop - a), room - (stop - a)
                    if left <= 0 or room <= 0:
                        break
            d = add_days(d, 1)
        out[e["id"]] = slots
    return out


def now_minutes() -> int:
    t = dt.datetime.now()
    return t.hour * 60 + t.minute


def occurrences(data: dict, start: str, end: str, today: str, now: int | None = None) -> list[dict]:
    """Every occurrence between two days (inclusive), as the app's week and month grids show them."""
    out = []
    slots = schedule(data, today, now_minutes() if now is None else now)
    for n, e in enumerate(data["entries"]):
        steps = e.get("steps") or []
        item = {"id": e.get("id"), "title": e.get("title"), "kind": e.get("kind") or "due", "from": "calendar", "order": n,
                "time": clock(e.get("time")), "end": clock(e.get("end")), "project": e.get("project"),
                "about": e.get("about"), "note": e.get("note"),
                "steps": [{"id": s.get("id"), "text": s.get("text"), "done": s.get("done") is True} for s in steps]}
        if e.get("kind") != "check":
            if is_auto(e) and not is_done(e) and pinned(e, today):
                if start <= e["date"] <= end:
                    out.append({**item, "when": e["date"], "done": False, "auto": True})
                continue
            if is_auto(e) and not is_done(e):
                days = list(dict.fromkeys(d for d, _, _ in slots.get(e.get("id"), [])))  # untimed, once a day, as the app
                out += [{**item, "when": d, "time": None, "end": None, "done": False, "auto": True}
                        for d in days if start <= d <= end]
                continue
            d = valid_day(e.get("done_on")) or valid_day(e.get("date")) if is_auto(e) else valid_day(e.get("date"))
            if d and start <= d <= end:
                out.append({**item, "when": d, "done": is_done(e), **({"time": None, "end": None} if is_auto(e) else {})})
            continue
        last = valid_day(e.get("last_done"))
        if last and start <= last <= end:
            out.append({**item, "when": last, "done": True})
        nxt, n = next_date(e, today), 0
        while nxt and nxt <= end and n < 60:
            if nxt >= start:
                out.append({**item, "when": nxt, "done": False, "cadence": e.get("cadence")})
            nxt, n = add_cadence(nxt, e["cadence"]), n + 1
    out += [p for p in pulse_items(today) if start <= p["when"] <= end]
    w, d = workday(data), start
    while d <= end:
        out += [{"id": f"routine:{r['title']}", "title": r["title"], "kind": "block", "from": "routine", "when": d,
                 "time": r["start"], "end": r["end"], "done": False, "note": "Every week", "steps": []} for r in routine_on(w, d)]
        d = add_days(d, 1)
    return sorted(out, key=lambda i: (i["when"], i.get("time") or "99", i.get("order", 10 ** 9), i["title"] or ""))


def undated(data: dict) -> list[dict]:
    return [e for e in data["entries"] if e.get("kind") != "check" and not valid_day(e.get("date")) and not is_auto(e)
            and not is_done(e)] + \
           [e for e in data["entries"] if e.get("kind") == "check" and e.get("cadence") not in CADENCES]


def minutes(t: str) -> int:
    return int(t[:2]) * 60 + int(t[3:])


def label(t: str | None) -> str:
    if not t:
        return ""
    h, m = int(t[:2]), int(t[3:])
    return f"{h % 12 or 12}{f':{m:02d}' if m else ''}{'am' if h < 12 else 'pm'}"


def line(i: dict, who: dict[str, str]) -> str:
    d = dt.date.fromisoformat(i["when"])
    when = f"{i['when']} {WEEKDAY[d.weekday()]}"
    t = f" {i['time']}–{i['end']}" if i.get("time") and i.get("end") else f" {i['time']}" if i.get("time") else ""
    steps = i.get("steps") or []
    bits = [who.get(i.get("project") or "", i.get("project") or "") or i.get("about") or "",
            f"{sum(s['done'] for s in steps)}/{len(steps)} steps" if steps else "", "done" if i.get("done") else "",
            "from pulse" if i.get("from") == "pulse" else ""]
    return f"{when}{t} [{i['kind']}] {i['title']} ({i['id']})" + "".join(f" · {b}" for b in bits if b)


def brief(start: str, end: str, today: str, now: int | None = None) -> str:
    """A brief the chat dock draws (lib/brief.ts): a lead, ```stats, then a ```flow per day with open steps."""
    data, who = load(), names()
    items = occurrences(data, start, end, today)
    planned = sum(minutes(i["end"]) - minutes(i["time"]) for i in items if i.get("time") and i.get("end") and i["kind"] == "block")
    open_steps = [(i, s) for i in items for s in i.get("steps") or [] if not s["done"]]
    due = [e for e in data["entries"] if e.get("kind") == "due" and valid_day(e.get("date")) and e["date"] >= today]
    due.sort(key=lambda e: e["date"])
    first = f"{WEEKDAY[dt.date.fromisoformat(start).weekday()]} {start}"
    span = "Today" if start == end == today else first if start == end else f"{first} to {end}"
    out = [f"{span}: {len(items)} on the calendar, {planned / 60:g}h of planned work, {len(open_steps)} steps open.", "",
           "```stats"]
    out.append(f"{planned / 60:g}h | planned work")
    out.append(f"{len(open_steps)} | steps open")
    for e in due[:2]:
        n = (dt.date.fromisoformat(e["date"]) - dt.date.fromisoformat(today)).days
        out.append(f"{n}d | to {e['title']}")
    out.append("```")
    now = now if now is not None else dt.datetime.now().hour * 60 + dt.datetime.now().minute
    day = start
    while day <= end:
        todays = [i for i in items if i["when"] == day]
        if todays:
            out += ["", f"**{WEEKDAY[dt.date.fromisoformat(day).weekday()]} {day}**", "```flow"]
            for i in todays:
                if i.get("done") or day < today:
                    state = "done"
                elif day == today and i.get("time") and minutes(i["time"]) <= now < minutes(i.get("end") or i["time"]) + (0 if i.get("end") else 30):
                    state = "now"
                else:
                    state = "risk" if i["kind"] == "due" else "next" if day == today else ""
                t = f"{label(i.get('time'))}–{label(i.get('end'))} " if i.get("time") and i.get("end") else f"{label(i.get('time'))} " if i.get("time") else ""
                steps = i.get("steps") or []
                note = " · ".join(x for x in (who.get(i.get("project") or "", "") or (i.get("about") or ""),
                                              f"{sum(s['done'] for s in steps)}/{len(steps)} steps" if steps else "",
                                              i.get("note") if i.get("from") == "pulse" else "") if x)
                out.append(" | ".join(x for x in (f"{t}{i['title']}", note, state) if x).replace("\n", " "))
            out.append("```")
        day = add_days(day, 1)
    if open_steps:
        out += ["", "Open steps:"] + [f"- {i['title']}: {s['text']}" for i, s in open_steps[:12]]
    loose = undated(data)
    if loose:
        out += ["", "No date yet: " + ", ".join(e.get("title", "") for e in loose)]
    return "\n".join(out)


# --- writes -----------------------------------------------------------------------------------------------------

def by_thread(by: str | None) -> str:
    if not by:
        raise SystemExit("Writes need --by <thread>.")
    rel = by.strip().rstrip("/")
    if rel.startswith("/") or ".." in rel.split("/") or not (ROOT / rel / "thread.md").is_file():
        raise SystemExit(f"Not a thread: {by}")
    pin = os.environ.get(CHAT_PIN)
    if pin and (ROOT / rel).resolve() != (ROOT / pin).resolve():
        raise SystemExit("This chat can only write in its own name.")
    return rel


def find(data: dict, entry_id: str) -> dict:
    for e in data["entries"]:
        if e.get("id") == entry_id:
            return e
    raise SystemExit(f"No entry {entry_id!r}. `agenda.py list` shows the ids.")


def check_times(kind: str, date: str | None, time: str | None, end: str | None, auto: bool = False) -> None:
    if end and (not time or end <= time):
        raise SystemExit("The end comes after the start.")
    if kind == "block" and not date and not auto:
        raise SystemExit("Planned work (block) needs --date or --auto.")


def steps_of(texts: list[str]) -> list[dict]:
    out: list[dict] = []
    for t in [t.strip()[:200] for t in texts if t.strip()][:30]:
        out.append({"id": fresh_id(t, None, {s["id"] for s in out}), "text": t, "done": False})
    return out


def add(a: argparse.Namespace, today: str) -> dict:
    by = by_thread(a.by)
    title = re.sub(r"\s+", " ", a.title or "").strip()
    if not title or len(title) > 120:
        raise SystemExit("--title is required (under 120 characters).")
    kind = a.kind
    date = valid_day(a.date) if a.date else None
    if a.date and not date:
        raise SystemExit("--date is YYYY-MM-DD.")
    time, end = clock(a.time) if a.time else None, clock(a.end) if a.end else None
    if (a.time and not time) or (a.end and not end):
        raise SystemExit("Times are HH:MM (24-hour).")
    auto = bool(a.auto) and kind != "check"
    if (a.spread or a.hours is not None) and not auto:
        raise SystemExit("--spread and --hours go with --auto.")
    hours = hours_of(a.hours) if a.hours is not None else None
    if a.hours is not None and not hours:
        raise SystemExit("--hours is a number up to 200.")
    if auto and (time or end):
        raise SystemExit("Auto work is placed for the owner; leave out --time and --end.")
    check_times(kind, date, time, end, auto)
    if a.project and not (ROOT / "companies" / a.project / "company.json").is_file():
        raise SystemExit(f"Unknown project {a.project!r}.")
    links = []
    for raw in a.link or []:
        lab, _, href = raw.partition("=")
        if not lab.strip() or not re.match(r"https?://", href.strip()):
            raise SystemExit("--link is \"label=https://…\".")
        links.append({"label": lab.strip()[:60], "href": href.strip()[:500]})
    data = load()
    quote = re.sub(r"\s+", " ", a.quote or "").strip()[:300]
    entry = {"id": fresh_id(title, date, {e.get("id") for e in data["entries"]}), "title": title, "kind": kind}
    if kind == "check":
        entry |= {"cadence": a.cadence if a.cadence in CADENCES else None, "last_done": None}
    else:
        entry |= {"date": date}
        if time:
            entry["time"] = time
        if end:
            entry["end"] = end
    for k in ("project", "about", "note"):
        v = (getattr(a, k) or "").strip()
        if v:
            entry[k] = v[:1000]
    if links:
        entry["links"] = links
    if a.step:
        entry["steps"] = steps_of(a.step)
    if a.type:
        entry["type"] = a.type
    if auto:
        entry["auto"] = True
        if a.spread:
            entry["spread"] = True
        if hours:
            entry["hours"] = hours
    entry["source"] = {"source": "agent", "ref": f"{by}" + (f" · the owner: “{quote}”" if quote else ""), "date": today}
    data["entries"].append(entry)
    save(data, today)
    return entry


def move(a: argparse.Namespace, today: str) -> dict:
    by_thread(a.by)
    data = load()
    e = find(data, a.id)
    if e.get("kind") == "check":
        raise SystemExit("A check has no date to move; it comes round by its cadence.")
    date = valid_day(a.date) if a.date else e.get("date")
    if a.date and not date:
        raise SystemExit("--date is YYYY-MM-DD.")
    time = clock(a.time) if a.time else e.get("time")
    end = clock(a.end) if a.end else e.get("end")
    if (a.time and not time) or (a.end and not end):
        raise SystemExit("Times are HH:MM (24-hour).")
    check_times(e.get("kind") or "due", date, time, end, is_auto(e))
    e["date"] = date
    for k, v in (("time", time), ("end", end)):
        if v:
            e[k] = v
    save(data, today)
    return e


def done(a: argparse.Namespace, today: str) -> dict:
    by_thread(a.by)
    data = load()
    e = find(data, a.id)
    if e.get("kind") != "check":
        e["done"] = not a.undo
        if a.undo:
            e.pop("done_on", None)
        else:
            e["done_on"] = today
        save(data, today)
        return e
    if a.undo:
        raise SystemExit("A check can't be undone here; the owner edits it on /calendar.")
    e["last_done"] = today
    save(data, today)
    return e


def step(a: argparse.Namespace, today: str) -> dict:
    by_thread(a.by)
    data = load()
    e = find(data, a.id)
    for s in e.get("steps") or []:
        if s.get("id") == a.step_id:
            s["done"] = not a.undo
            if a.undo:
                s.pop("done_on", None)
            else:
                s["done_on"] = today
            save(data, today)
            return e
    raise SystemExit(f"No step {a.step_id!r} on {a.id}.")


def set_workday(a: argparse.Namespace, today: str) -> dict:
    by_thread(a.by)
    data = load()
    w = dict(data.get("workday") if isinstance(data.get("workday"), dict) else {})
    for k in ("start", "end", "late"):
        v = getattr(a, k)
        if v is not None:
            if not clock(v):
                raise SystemExit("Times are HH:MM (24-hour).")
            w[k] = v
    if a.days is not None:
        try:
            days = sorted({int(x) for x in a.days.split(",") if x.strip()})
        except ValueError:
            raise SystemExit("--days is 0 (Sunday) to 6 (Saturday), comma-separated.")
        if not days or any(not 0 <= x <= 6 for x in days):
            raise SystemExit("--days is 0 (Sunday) to 6 (Saturday), comma-separated.")
        w["days"] = days
    if a.no_routine:
        w["routine"] = []
    for raw in a.routine or []:
        parts = [x.strip() for x in raw.split("|")]
        if len(parts) != 4:
            raise SystemExit('--routine is "Title|0,6|HH:MM|HH:MM".')
        r = routine_of([{"title": parts[0], "days": [int(x) for x in parts[1].split(",") if x.strip().isdigit()],
                         "start": parts[2], "end": parts[3]}])
        if not r:
            raise SystemExit('--routine is "Title|0,6|HH:MM|HH:MM" with the end after the start.')
        w["routine"] = [x for x in w.get("routine") or [] if x.get("title") != r[0]["title"]] + r
    start, end = clock(w.get("start")) or WORKDAY["start"], clock(w.get("end")) or WORKDAY["end"]
    late = clock(w.get("late")) or max(end, WORKDAY["late"])
    if not (end > start and late >= end):
        raise SystemExit("The day ends after it starts, and --late is no earlier than --end.")
    data["workday"] = w
    save(data, today)
    return {"id": "workday", "title": f"{start}–{end} (late {late}), days {w.get('days', WORKDAY['days'])}, "
                                       f"{len(w.get('routine') or [])} routine"}


def rename(a: argparse.Namespace, today: str) -> dict:
    by_thread(a.by)
    if a.title is None and a.type is None:
        raise SystemExit("Give --title, --type or both.")
    title = re.sub(r"\s+", " ", a.title or "").strip()
    if a.title is not None and (not title or len(title) > 120):
        raise SystemExit("--title is under 120 characters.")
    if a.type and a.type not in TYPES:
        raise SystemExit(f"--type is one of {', '.join(TYPES)} (or \"\").")
    data = load()
    e = find(data, a.id)
    if title:
        e["title"] = title
    if a.type is not None:
        if a.type:
            e["type"] = a.type
        else:
            e.pop("type", None)
    save(data, today)
    return e


def remove(a: argparse.Namespace, today: str) -> dict:
    by_thread(a.by)
    data = load()
    e = find(data, a.id)
    if (e.get("source") or {}).get("source") != "agent":
        raise SystemExit("Only entries an agent added can be removed here; the owner removes their own on /calendar.")
    data["entries"] = [x for x in data["entries"] if x is not e]
    save(data, today)
    return e


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--by", help="the thread a write comes from (its folder, e.g. holding/threads/chat)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("list")
    s.add_argument("--from", dest="start")
    s.add_argument("--to", dest="end")
    s.add_argument("--json", action="store_true")
    s = sub.add_parser("brief")
    g = s.add_mutually_exclusive_group()
    g.add_argument("--day")
    g.add_argument("--week")
    s = sub.add_parser("add")
    s.add_argument("--title", required=True)
    s.add_argument("--kind", choices=KINDS, default="block")
    for k in ("date", "time", "end", "project", "about", "note", "quote"):
        s.add_argument(f"--{k}")
    s.add_argument("--cadence", choices=CADENCES)
    s.add_argument("--step", action="append")
    s.add_argument("--link", action="append")
    s.add_argument("--type", choices=TYPES)
    s.add_argument("--auto", action="store_true")
    s.add_argument("--spread", action="store_true")
    s.add_argument("--hours", type=float)
    s = sub.add_parser("move")
    s.add_argument("id")
    for k in ("date", "time", "end"):
        s.add_argument(f"--{k}")
    s = sub.add_parser("done")
    s.add_argument("id")
    s.add_argument("--undo", action="store_true")
    s = sub.add_parser("step")
    s.add_argument("id")
    s.add_argument("step_id")
    s.add_argument("--undo", action="store_true")
    sub.add_parser("remove").add_argument("id")
    s = sub.add_parser("rename")
    s.add_argument("id")
    s.add_argument("--title")
    s.add_argument("--type")
    s = sub.add_parser("workday")
    for k in ("start", "end", "late", "days"):
        s.add_argument(f"--{k}")
    s.add_argument("--routine", action="append")
    s.add_argument("--no-routine", action="store_true")
    a = p.parse_args(argv)
    today = today_local()

    if a.cmd == "list":
        start = valid_day(a.start) or week_start(today)
        end = valid_day(a.end) or add_days(start, 6)
        if end < start or (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days > 370:
            raise SystemExit("--to comes after --from, within a year.")
        data = load()
        items = occurrences(data, start, end, today)
        if a.json:
            print(json.dumps({"from": start, "to": end, "items": items, "no_date": undated(data)}, ensure_ascii=False, indent=2))
            return
        who = names()
        print("\n".join(line(i, who) for i in items) or f"Nothing between {start} and {end}.")
        loose = undated(data)
        if loose:
            print("No date yet: " + ", ".join(f"{e.get('title')} ({e.get('id')})" for e in loose))
        return
    if a.cmd == "brief":
        if a.day:
            d = valid_day(a.day)
            if not d:
                raise SystemExit("--day is YYYY-MM-DD.")
            print(brief(d, d, today))
        else:
            start = week_start(valid_day(a.week) or today)
            print(brief(start, add_days(start, 6), today))
        return
    entry = {"add": add, "move": move, "done": done, "step": step, "remove": remove, "workday": set_workday,
             "rename": rename}[a.cmd](a, today)
    verb = {"add": "Added", "move": "Moved", "done": "Reopened" if getattr(a, "undo", False) else "Done", "step": "Ticked",
            "remove": "Removed", "workday": "Set", "rename": "Renamed"}[a.cmd]
    print(f"{verb} {entry.get('id')}: {entry.get('title')} · holding/calendar.json")


if __name__ == "__main__":
    main()
