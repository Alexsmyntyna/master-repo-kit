#!/usr/bin/env python3
"""Versioned data migrations. Missing holding/schema.json means version 1."""
from __future__ import annotations
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import paths

DATA_FOLDERS = ('companies', 'holding', 'identity', 'ideas', 'queue', 'discovery', 'local', 'guide', 'standards', 'skills')
OWNER_FIELDS = {'source', 'kind_source', 'written_by', 'raised_by', 'from', 'to', 'last_from', 'who', 'done_by', 'author', 'type'}
KEYS = {'owned_by_alex': 'owned_by_owner', 'alexPackages': 'ownerPackages'}

def version(root: Path) -> int:
    file = root / 'holding/schema.json'
    n = json.loads(file.read_text())['version'] if file.exists() else 1
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        raise ValueError('Invalid data schema version')
    return n

def owner_values(value, key='', counts=None):
    counts = counts if counts is not None else Counter()
    if isinstance(value, dict):
        result = {}
        for k, v in value.items():
            new = KEYS.get(k, k)
            if new != k:
                if new in value:
                    raise ValueError(f'Both {k} and {new} exist; resolve before migrating')
                counts['keys'] += 1
            result[new] = owner_values(v, k, counts)
        return result
    if isinstance(value, list):
        return [owner_values(v, key, counts) for v in value]
    if isinstance(value, str):
        if value == 'alex' and (key in OWNER_FIELDS or key == 'participants'):
            counts['values'] += 1
            return 'owner'
        if value == 'awaiting-alex':
            counts['values'] += 1
            return 'awaiting-owner'
        new, n = re.subn(r'(?<![\w-])([\w.-]+)-alex\.md\b', r'\1-owner.md', value)
        counts['references'] += n
        return new
    return value

def migration_2(root: Path, dry_run=False) -> dict:
    root = root.resolve()
    counts = Counter(files=0, renamed=0, values=0, keys=0, references=0)
    edits, renames = [], []
    for folder in DATA_FOLDERS:
        base = root / folder
        if base.is_symlink():
            continue
        for file in sorted(base.rglob('*')) if base.exists() else []:
            if file.is_symlink() or any((root / p).is_symlink() for p in file.relative_to(root).parents) or not file.is_file():
                continue
            if file.suffix not in ('.json', '.md') or file == root / 'holding/schema.json':
                continue
            original = file.read_text()
            if file.suffix == '.json':
                data = json.loads(original)
                changed = owner_values(data, counts=counts)
                text = json.dumps(changed, indent=2, ensure_ascii=False) + '\n' if changed != data else original
            else:
                text = original
                match = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', text, re.S)
                if match:
                    head = match[1]
                    fields = '|'.join(sorted(OWNER_FIELDS | {'participants', 'status'}))
                    def field(m):
                        raw = m[2]
                        # Simple scalar / inline list values; never rewrite prose or block scalars.
                        new, n = re.subn(r'''(?<![\w-])alex(?![\w-])''', 'owner', raw) if (raw.strip("\"'") == 'alex' or (m[1] == 'participants' and raw.startswith('['))) else (raw, 0)
                        new, n2 = re.subn(r'\bawaiting-alex\b', 'awaiting-owner', new)
                        counts['values'] += n + n2
                        return m[1] + ': ' + new
                    head = re.sub(rf'^({fields}):[ \t]*(.*)$', field, head, flags=re.M)
                    head, n = re.subn(r'^owned_by_alex:', 'owned_by_owner:', head, flags=re.M)
                    counts['keys'] += n
                    text = text[:match.start(1)] + head + text[match.end(1):]
                text, n = re.subn(r'(?<![\w-])([\w.-]+)-alex\.md\b', r'\1-owner.md', text)
                counts['references'] += n
            if text != original:
                edits.append((file, text)); counts['files'] += 1
            if file.name.endswith('-alex.md'):
                target = file.with_name(file.name[:-8] + '-owner.md')
                if target.exists():
                    raise ValueError(f'Rename collision: {target}')
                renames.append((file, target)); counts['renamed'] += 1
    if not dry_run:
        for file, text in edits:
            file.write_text(text)
        for file, target in renames:
            file.rename(target)
    return dict(counts)

MIGRATIONS = [(2, migration_2)]
LATEST_VERSION = MIGRATIONS[-1][0]

def migrate(root: Path = paths.ROOT, dry_run=False) -> dict:
    current = version(root)
    if current > LATEST_VERSION:
        raise ValueError(f'Data schema {current} is newer than this kit ({LATEST_VERSION})')
    totals = Counter()
    for target, operation in MIGRATIONS:
        if target > current:
            totals.update(operation(root, dry_run))
            if not dry_run:
                schema = root / 'holding/schema.json'
                schema.parent.mkdir(parents=True, exist_ok=True)
                schema.write_text(json.dumps({'version': target}, indent=2) + '\n')
    return {'from': current, 'to': LATEST_VERSION, 'dry_run': dry_run, **totals}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    print(json.dumps(migrate(dry_run=args.dry_run), indent=2))

if __name__ == '__main__':
    main()
