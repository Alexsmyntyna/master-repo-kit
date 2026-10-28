#!/usr/bin/env python3
"""Layered standards ledger. Later levels extend earlier ones; explicit overrides replace matching text."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date
import json
from pathlib import Path
import re
import sys

import paths

LEVELS = ('generic', 'owner', 'project')
# Evidence can cite another codebase (finance-app/CLAUDE.md); those live beside this repo, as in tools/codebases.py.
CODE = Path.home() / 'Documents' / 'GitHub'


def resolves(root: Path, evidence: str) -> bool:
    for base in (root, CODE):
        if any(base.glob(evidence)) if '*' in evidence else (base / evidence).exists():
            return True
    head, _, rest = evidence.partition('/')
    folder = next((f for f in CODE.glob('*') if f.name.casefold() == head.casefold()), None) if CODE.is_dir() else None
    return bool(folder and rest and (any(folder.glob(rest)) if '*' in rest else (folder / rest).exists()))


def rule_files(root: Path, project: str | None = None, all_projects: bool = False):
    for scope, folder in [('generic', root / 'standards'), ('owner', root / 'local/standards')]:
        for file in sorted(folder.glob('*.md')):
            if file.stem.lower() not in ('readme', 'index', 'evidence', 'notes'):
                yield scope, None, file
    if project and not re.fullmatch(r'[a-z0-9-]+', project):
        raise ValueError('Invalid project slug')
    files = sorted((root / 'companies').glob('*/standards.md')) if all_projects else ([root / 'companies' / project / 'standards.md'] if project else [])
    for file in files:
        if file.is_file() and not file.parent.name.startswith(('_', '.')):
            yield 'project', file.parent.name, file


def normalize(text: str) -> str:
    return ' '.join(re.findall(r'\w+', text.casefold()))


def parse_rules(content: str, scope: str, project: str | None, file: str, area: str):
    fenced = False
    for number, line in enumerate(content.splitlines(), 1):
        if line.startswith('```'):
            fenced = not fenced
        if fenced:
            continue
        if scope == 'project' and line.startswith('## '):
            area = line[3:].strip().lower().replace(' ', '-')
        if not re.match(r'^[-*] +', line):
            continue
        text = re.sub(r'^[-*] +', '', line).strip()
        match = re.search(r'\s*\((alex|owner|code|agent|public|kit)(?=[:, )])([\s\S]*)\)\.?$', text)
        provenance = match[1] if match else None
        ref = match[2].lstrip(':, ') if match else ''
        if match:
            text = text[:match.start()].strip()
        dates = re.findall(r'\b\d{4}-\d{2}-\d{2}\b', line)
        valid = []
        for value in dates:
            try:
                valid.append(date.fromisoformat(value).isoformat())
            except ValueError:
                pass
        path_refs = re.sub(r'https?://[^\s`)]+', '', ref)
        evidence = re.findall(r'(?<![\w:/])(/?(?:[\w.~-]+/)+[\w.*@+()~-]+(?:\.[\w-]+)?)', path_refs)
        evidence = [p.rstrip('.') for p in evidence]
        struck = text.startswith('~~') and text.rstrip('.').endswith('~~')
        override = text.lower().startswith('override:')
        if struck:
            text = text.rstrip('.').strip('~')
        if override:
            text = text[len('override:'):].strip()
        yield dict(scope=scope, project=project, area=area, file=file, line=number, text=text,
                   provenance=provenance, date=max(valid) if valid else None, evidence_paths=evidence,
                   struck=struck, override=override)


def load_rules(root: Path | None = None, project: str | None = None, all_projects: bool = False):
    root = root or paths.ROOT
    return [rule for scope, slug, file in rule_files(root, project, all_projects)
            for rule in parse_rules(file.read_text(), scope, slug, str(file.relative_to(root)), file.stem)]


def effective_rules(records):
    """Exact text in a later layer replaces the earlier copy; struck lines act as tombstones."""
    result = {}
    for rule in records:
        key = (rule['area'], normalize(rule['text']))
        result.pop(key, None)
        if not rule['struck']:
            result[key] = rule
    return list(result.values())


def audit(root: Path | None = None, stale_days: int = 180, budget: int = 1500, project: str | None = None, on: date | None = None, level_budget: int = 6000):
    root, on = root or paths.ROOT, on or date.today()
    records = load_rules(root, all_projects=True)
    findings = []
    def add(kind, rule, reason):
        findings.append(dict(kind=kind, file=rule['file'], line=rule['line'], reason=reason))
    names = set()
    for folder in sorted((root / 'companies').glob('*')):
        if not folder.is_dir() or folder.name.startswith(('_', '.')):
            continue
        names.add(folder.name.casefold())
        try:
            name = json.loads((folder / 'company.json').read_text()).get('name')
            if isinstance(name, str) and name.strip():
                names.add(name.casefold())
        except (OSError, ValueError, AttributeError):
            pass
    names.discard(root.name.casefold())  # the hub's own name (MASTER-REPO.md) isn't a project
    active = [r for r in records if not r['struck']]
    for i, rule in enumerate(active):
        if not rule['provenance']:
            add('provenance', rule, 'missing provenance')
        for evidence in rule['evidence_paths']:
            if not resolves(root, evidence):
                add('evidence', rule, f'evidence not found here or in {CODE}: {evidence}')
        if rule['date'] and (on - date.fromisoformat(rule['date'])).days > stale_days:
            add('stale', rule, f'newest date {rule["date"]} is older than {stale_days} days')
        if rule['scope'] == 'generic':
            mentions = sorted(n for n in names if re.search(r'(?<!\w)' + re.escape(n) + r'(?!\w)', rule['text'], re.I))
            if mentions:
                add('project-name', rule, 'generic rule mentions project: ' + ', '.join(mentions))
        normalized = normalize(rule['text'])
        tokens = set(normalized.split())
        for other in active[:i]:
            other_text = normalize(other['text'])
            other_tokens = set(other_text.split())
            score = len(tokens & other_tokens) / len(tokens | other_tokens) if tokens | other_tokens else 0
            if normalized == other_text or score >= .6:
                add('duplicate' if normalized == other_text else 'near-duplicate', rule,
                    f'{"exact duplicate" if normalized == other_text else f"near duplicate ({score:.2f})"} of {other["file"]}:{other["line"]}')
    sizes, totals = [], {level: dict(words=0, tokens=0, rules=0) for level in LEVELS}
    for scope, slug, file in rule_files(root, all_projects=True):
        content = file.read_text()
        words, tokens = len(content.split()), (len(content) + 3) // 4
        relative = str(file.relative_to(root))
        sizes.append(dict(file=relative, scope=scope, project=slug, words=words, tokens=tokens))
        totals[scope]['words'] += words
        totals[scope]['tokens'] += tokens
        totals[scope]['rules'] += sum(r['file'] == relative for r in records)
        if tokens > budget:
            add('budget', dict(file=relative, line=1), f'{words} words / ~{tokens} tokens exceeds file budget {budget}')
        for number, line in enumerate(content.splitlines(), 1):
            if re.match(r'^#+\s+.*(?:not evidenced|thin evidence)', line, re.I):
                add('notes', dict(file=relative, line=number), 'notes section is not rules: ' + line.lstrip('# '))
    for level, total in totals.items():
        total['budget'] = level_budget
        if total['tokens'] > level_budget:
            add('level-budget', dict(file=f'({level} level)', line=0), f'{level} level ~{total["tokens"]} tokens exceeds level budget {level_budget}')
    context = [s for s in sizes if s['scope'] != 'project' or s['project'] == project]
    counts = dict(sorted(Counter(f['kind'] for f in findings).items()))
    summary = f'Rules audit: {len(records)} rules, {len(sizes)} files, {len(findings)} findings' + (f' ({", ".join(f"{k}={v}" for k, v in counts.items())})' if counts else '')
    return dict(summary=summary, counts=counts, findings=findings, files=sizes, levels=totals,
                context=dict(project=project, words=sum(s['words'] for s in context), tokens=sum(s['tokens'] for s in context)))


def condensation(root: Path, on: date | None = None) -> str:
    try:
        value = json.loads((root / 'holding/rules-condensed.json').read_text())['date']
        age = ((on or date.today()) - date.fromisoformat(value)).days
        return f'last condensed {value}' + (' (over 30 days)' if age > 30 else '')
    except (OSError, ValueError, KeyError, TypeError):
        return 'last condensed unknown (holding/rules-condensed.json missing or invalid)'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('audit', 'stats', 'load'):
        p = sub.add_parser(command)
        p.add_argument('--json', action='store_true')
        p.add_argument('--project')
        if command == 'audit':
            p.add_argument('--stale-days', type=int, default=180)
            p.add_argument('--budget', type=int, default=1500, help='approximate tokens per file')
            p.add_argument('--level-budget', type=int, default=6000, help='approximate tokens per level')
    args = parser.parse_args(argv)
    if args.project and not re.fullmatch(r'[a-z0-9-]+', args.project):
        parser.error('invalid project slug')
    if args.command == 'load':
        print(json.dumps(load_rules(project=args.project, all_projects=not args.project)))
    elif args.command == 'stats':
        counts = Counter((r['scope'], r['area']) for r in load_rules(project=args.project, all_projects=not args.project))
        rows = [dict(scope=s, area=a, count=n) for (s, a), n in sorted(counts.items())]
        print(json.dumps(rows) if args.json else '\n'.join(f'{r["scope"]:8} {r["area"]:20} {r["count"]}' for r in rows))
    else:
        report = audit(stale_days=args.stale_days, budget=args.budget, project=args.project, level_budget=args.level_budget)
        if args.json:
            print(json.dumps(report))
        else:
            print(report['summary'])
            for f in report['findings']:
                print(f'{f["file"]}:{f["line"]}: {f["reason"]}')
            for f in report['files']:
                print(f'{f["file"]}:1: size {f["words"]} words / ~{f["tokens"]} tokens')
            for level, total in report['levels'].items():
                print(f'{level}: {total["words"]} words / ~{total["tokens"]} tokens (budget {total["budget"]})')
            print(f'Context ({args.project or "generic + owner"}): {report["context"]["words"]} words / ~{report["context"]["tokens"]} tokens')
    return 0


if __name__ == '__main__':
    sys.exit(main())
