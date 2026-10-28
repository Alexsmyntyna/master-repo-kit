#!/usr/bin/env python3
"""Export the public kit, then report leaks. --check (or scan DIR) only scans.

Exceptions in kit.json: {"file": "relative/path", "pattern": "exact matched text",
"reason": "why this is public"}. Exceptions are literal, case-sensitive and file-specific.
The manifest belongs to the code checkout; private scan terms belong to the data root.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import fnmatch
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import shlex

try:
    from . import paths
except ImportError:
    import paths


@dataclass(frozen=True)
class Leak:
    file: str
    line: int
    category: str
    match: str


def manifest(code: Path) -> dict:
    data = json.loads((code / 'kit.json').read_text())
    for entry in data.get('ignore_terms', []):
        if not all(isinstance(entry.get(k), str) and entry[k].strip() for k in ('term', 'reason')):
            raise ValueError('Every ignored term needs term and reason')
    for entry in data.get('allow', []):
        if not all(isinstance(entry.get(k), str) and entry[k].strip()
                   for k in ('file', 'pattern', 'reason')):
            raise ValueError('Every allow exception needs file, pattern and reason')
    for source, destination in data.get('copy', {}).items():
        for name in (source, destination):
            if not isinstance(name, str) or not name or Path(name).is_absolute() or '..' in Path(name).parts:
                raise ValueError('Copy paths must stay inside the export tree')
    return data


def selected(name: str, config: dict) -> bool:
    p = Path(name)
    if p.is_absolute() or '..' in p.parts:
        return False
    if not any(name.startswith(item) if item.endswith('/') else name == item
               for item in config['include']):
        return False
    # Privacy boundaries apply even if a future manifest widens its allowlist.
    if p.parts[0] in {'holding', 'archive', 'ideas', 'identity', 'discovery', 'queue'}:
        return False
    if p.parts[0] == 'companies' and p.parts[1:2] != ('_template',):
        return False
    if p.parts[0] == 'local' and '.example' not in p.name:
        return False
    if any(part in {'node_modules', '.next', '__pycache__', '.git', 'logs', 'screenshots'}
           or part.startswith('.env') for part in p.parts):
        return False
    if p.suffix.lower() == '.log' or 'screenshot' in p.name.lower():
        return False
    return not any(fnmatch.fnmatchcase(name, pat) or
                   fnmatch.fnmatchcase(name, pat.removeprefix('**/'))
                   for pat in config.get('exclude', []))


def export_tree(code: Path, target: Path, config: dict, force: bool = False) -> None:
    code, target = code.resolve(), target.resolve()
    if target == code or target in code.parents or code in target.parents:
        raise ValueError('Export target must be outside the code checkout')
    if target.exists() and (not target.is_dir() or any(target.iterdir())):
        if not force or not target.is_dir():
            raise ValueError('Target must be an empty directory (or use --force)')
    result = subprocess.run(['git', '-C', str(code), 'ls-files', '-co', '--exclude-standard', '-z'],
                            check=True, capture_output=True)
    names = sorted(set(result.stdout.decode('utf-8').split('\0')) - {''})
    files = [name for name in names if selected(name, config) and (code / name).is_file()]
    for name in files:
        source = code / name
        if source.is_symlink() or any(parent.is_symlink() for parent in source.parents):
            raise ValueError(f'Refusing symlink: {name}')
    if target.exists() and force:
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    for name in files:
        destination = target / config.get('copy', {}).get(name, name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(code / name, destination)


def rules(root: Path, config: dict | None = None) -> list[tuple[str, re.Pattern]]:
    literals: set[tuple[str, str]] = set()
    owner_file = root / 'local/owner.json'
    owner = json.loads(owner_file.read_text()) if owner_file.exists() else {}
    for key in ('name', 'short', 'emails', 'handles'):
        values = owner.get(key, [])
        for value in ([values] if isinstance(values, str) else values):
            if isinstance(value, str) and value.strip():
                literals.add(('owner', value.strip()))
    if owner.get('name'):
        literals.add(('owner', owner['name'].split()[0]))
    for file in (root / 'companies').glob('*/company.json'):
        if file.parent.name in {'_template', 'master-repo', 'master-repo-kit'}:
            continue
        literals.add(('project', file.parent.name))
        name = json.loads(file.read_text()).get('name')
        if isinstance(name, str) and name.strip():
            literals.add(('project', name.strip()))
    if isinstance(owner.get('vault'), str) and owner['vault'].strip():
        literals.add(('vault', owner['vault'].strip()))
    owner_notes = root / 'local/owner.md'
    if owner_notes.exists():
        for vault in re.findall(r'`([^`\n]*(?:obsidian|Obsidian)[^`\n]*)`', owner_notes.read_text()):
            literals.add(('vault', vault))
    ignored = {entry['term'].casefold() for entry in (config or {}).get('ignore_terms', [])}
    literals = {(category, value) for category, value in literals
                if category != 'project' or value.casefold() not in ignored}
    compiled = [(category, re.compile(r'(?<!\w)' + re.escape(value) + r'(?!\w)', re.I))
                for category, value in sorted(literals)]
    compiled.extend((category, re.compile(pattern, re.I)) for category, pattern in [
        ('home-path', r'/Users/[^/\s]+/|~/Library/Mobile Documents'),
        ('email', r"(?<![A-Z0-9._%+`-])[A-Z0-9._%+-]+@(?!(?:[A-Z0-9-]+\.)*(?:md|tsx?|py)(?![A-Z0-9.-]))[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?\.[A-Z]{2,}(?![A-Z0-9.-])"),
        ('secret', r'\bsk-[A-Za-z0-9_-]{16,}|\bghp_[A-Za-z0-9]{20,}|\bAKIA[A-Z0-9]{16}\b|-----BEGIN'),
    ])
    return compiled


def scan_tree(target: Path, root: Path, config: dict) -> tuple[list[Leak], int, int]:
    if not target.is_dir():
        raise ValueError('Scan target must be an existing directory')
    checks = rules(root, config)
    allowed = {(e['file'], e['pattern']) for e in config.get('allow', [])}
    leaks, count, size = [], 0, 0
    for file in sorted(target.rglob('*')):
        if file.is_symlink():
            raise ValueError(f'Refusing scan symlink: {file}')
        if not file.is_file():
            continue
        raw = file.read_bytes()
        # Latin-1 preserves every byte in binary files, including ASCII emails/handles.
        try:
            content = raw.decode('utf-8')
        except UnicodeDecodeError:
            content = raw.decode('latin-1')
        count += 1
        size += len(raw)
        name = file.relative_to(target).as_posix()
        for category, pattern in checks:
            for match in pattern.finditer(content):
                value = match.group()
                if (name, value) in allowed:
                    continue
                if category == 'email':
                    user, domain = value.lower().rsplit('@', 1)
                    if domain == 'example.com' or 'noreply' in user or 'noreply' in domain:
                        continue
                leaks.append(Leak(name, content.count('\n', 0, match.start()) + 1, category, value))
    return leaks, count, size


def release(code: Path, root: Path, target: Path, version: str, config: dict) -> None:
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version):
        raise ValueError('Version must be X.Y.Z')
    target = target.resolve()
    if target == code.resolve() or target in code.resolve().parents or code.resolve() in target.parents:
        raise ValueError('Release target must be outside the code checkout')
    def git(*args):
        return subprocess.run(['git', '-C', str(target), *args], check=True, capture_output=True, text=True).stdout
    # Scan a complete staged export before replacing any release checkout files.
    with tempfile.TemporaryDirectory() as temporary:
        staged = Path(temporary) / 'export'
        export_tree(code, staged, config)
        metadata = json.loads((staged / 'kit.json').read_text())
        metadata['version'] = version
        (staged / 'kit.json').write_text(json.dumps(metadata, indent=2) + '\n')
        leaks, _, _ = scan_tree(staged, root, config)
        if leaks:
            raise ValueError('Release leak scan failed:\n' + '\n'.join(f'{l.file}:{l.line}:{l.match}' for l in leaks))
        target.mkdir(parents=True, exist_ok=True)
        if not (target / '.git').exists():
            git('init', '-b', 'main')
        else:
            if git('status', '--porcelain').strip():
                raise ValueError('Release checkout must be clean')
            if git('branch', '--show-current').strip() != 'main':
                raise ValueError('Release checkout must be on main')
        tag = 'v' + version
        if git('tag', '--list', tag).strip():
            raise ValueError(f'Tag already exists: {tag}')
        for child in target.iterdir():
            if child.name == '.git':
                continue
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
        shutil.copytree(staged, target, dirs_exist_ok=True)
        git('add', '-A')
        git('commit', '-m', f'Release {tag}')
        git('tag', '-a', tag, '-m', f'Release {tag}')
    print('Release scan: 0 matches')
    print(shlex.join(['git', '-C', str(target), 'push', 'origin', 'main', '--tags']))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', nargs='?', help='export directory, or scan')
    parser.add_argument('scan_dir', nargs='?')
    parser.add_argument('--check', action='store_true', help='scan existing tree without writing')
    parser.add_argument('--force', action='store_true', help='replace nonempty target')
    parser.add_argument('--release', metavar='KIT_CHECKOUT_DIR')
    parser.add_argument('--version')
    args = parser.parse_args(argv)
    if args.release:
        if not args.version or args.target or args.check or args.force:
            parser.error('Use --release DIR --version X.Y.Z')
        try:
            release(paths.CODE, paths.ROOT, Path(args.release).expanduser(), args.version, manifest(paths.CODE))
            return 0
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            parser.exit(2, f'export: {exc}\n')
    if not args.target or args.version:
        parser.error('Supply an export target, scan DIR, or --release DIR --version X.Y.Z')
    if (args.target == 'scan') != bool(args.scan_dir):
        parser.error('Use scan DIR, or DIR [--check] [--force]')
    try:
        config = manifest(paths.CODE)
        target = Path(args.scan_dir or args.target).expanduser()
        if not args.check and args.target != 'scan':
            export_tree(paths.CODE, target, config, args.force)
        leaks, count, size = scan_tree(target, paths.ROOT, config)
        for leak in leaks:
            print(f'{leak.file}:{leak.line}:{leak.match} [{leak.category}]')
        print(f'Files shipped: {count}; bytes: {size}; leaks: {len(leaks)}')
        print('Categories: ' + ', '.join(f'{k}={v}' for k, v in Counter(l.category for l in leaks).most_common()))
        print('Top 20 files:')
        for name, total in Counter(l.file for l in leaks).most_common(20):
            print(f'  {name}: {total}')
        return int(bool(leaks))
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        parser.exit(2, f'export: {exc}\n')


if __name__ == '__main__':
    raise SystemExit(main())
