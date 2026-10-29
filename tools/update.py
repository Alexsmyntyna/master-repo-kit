#!/usr/bin/env python3
"""Merge the kit engine, then migrate data and refresh shipped skill wrappers."""
import os
from pathlib import Path
import re
import subprocess
import sys
import paths

ENGINE = ('tools', 'app', 'agents', 'skills', 'standards', 'kit', 'docs', 'companies/_template', '.claude/skills', '.github')
ENGINE_FILES = {'AGENTS.md', 'CLAUDE.md', 'DATA.md', 'README.md', 'CHANGELOG.md', 'LICENSE', 'kit.json', '.gitignore', 'local/owner.example.json'}
# Written by tools/skills.py sync from shipped skills plus local/skills/, so a hub's copy differs whenever it has overrides.
GENERATED = ('skills/INDEX.md', '.claude/skills/')

def git(code: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(code), *args], check=True, text=True, stdout=subprocess.PIPE).stdout

def is_engine(file: str) -> bool:
    return file in ENGINE_FILES or any(file == d or file.startswith(d + '/') for d in ENGINE)

def is_generated(file: str) -> bool:
    return file.startswith(GENERATED)

def edited_engine_files(code: Path) -> list[str]:
    # Include staged and unstaged changes, renames, and deletions of tracked engine files.
    raw = git(code, 'status', '--porcelain=v1', '-z', '--untracked-files=no').split('\0')
    files = []
    i = 0
    while i < len(raw):
        entry = raw[i]; i += 1
        if not entry:
            continue
        names = [entry[3:]]
        if 'R' in entry[:2] or 'C' in entry[:2]:
            names.append(raw[i]); i += 1
        files.extend(n for n in names if is_engine(n))
    return sorted(set(files))

def is_kit_checkout(code: Path) -> bool:
    if not (code / 'kit.json').is_file():
        return False
    # The private source checkout also has kit.json. Its tracked portfolio is not a kit installation.
    tracked = git(code, 'ls-files', '-z').split('\0')
    private_roots = ('holding/', 'identity/', 'ideas/', 'queue/', 'discovery/', 'local/', 'companies/')
    return not any(f.startswith(private_roots) and not is_engine(f) for f in tracked if f)


def incoming_changelog(code: Path, ref: str) -> str:
    def read(revision):
        result = subprocess.run(['git', '-C', str(code), 'show', f'{revision}:CHANGELOG.md'],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return result.stdout if result.returncode == 0 else ''
    old = read('HEAD')
    new = read(ref)
    sections = re.split(r'(?=^## )', new, flags=re.M)
    incoming = [section.strip() for section in sections if section.startswith('## ') and section.strip() not in old]
    if incoming:
        return 'Incoming CHANGELOG.md:\n\n' + '\n\n'.join(incoming)
    return new if new != old else 'No incoming CHANGELOG.md changes.'


def overridden_changes(code: Path, root: Path, base: str, ref: str) -> list[str]:
    # Shipped skills the incoming release changed that the hub overrides in local/skills/.
    changed = git(code, 'diff', '--name-only', base, ref, '--', 'skills/*.md').splitlines()
    return [f for f in changed if f != 'skills/INDEX.md' and (root / 'local' / f).is_file()]


def update(code: Path = paths.CODE, root: Path = paths.ROOT) -> None:
    dirty = git(code, 'status', '--porcelain=v1', '--untracked-files=no').strip()
    if dirty:
        hint = '\nMove customizations to local/ overrides before updating.' if edited_engine_files(code) else ''
        raise SystemExit('Refusing update: uncommitted tracked files:\n' + dirty + hint)
    remotes = git(code, 'remote').splitlines()
    if 'kit' in remotes:
        remote = 'kit'
    elif 'origin' in remotes and ('master-repo-kit' in git(code, 'remote', 'get-url', 'origin') or is_kit_checkout(code)):
        remote = 'origin'
    else:
        raise SystemExit('No kit remote. Add a remote named kit; origin is used only in a kit checkout (kit.json).')
    # Explicit HEAD also works for a freshly added kit remote with no remote-tracking HEAD.
    git(code, 'fetch', '--tags', remote, 'HEAD')
    ref = 'FETCH_HEAD'
    before = git(code, 'rev-parse', 'HEAD').strip()
    base = git(code, 'merge-base', 'HEAD', ref).strip()
    edits = [f for f in git(code, 'diff', '--name-only', base, 'HEAD').splitlines() if is_engine(f) and not is_generated(f)]
    if edits:
        raise SystemExit('Refusing update: tracked engine files edited since the merge base:\n' + '\n'.join(edits) + '\nMove customizations to local/ overrides before updating.')
    incoming = git(code, 'diff', '--name-only', base, ref).splitlines()
    # The merge must never update data files, even when code and data share a checkout.
    data = [f for f in incoming if not is_engine(f)]
    if data:
        raise SystemExit('Refusing update: incoming changes include data or unrecognized paths:\n' + '\n'.join(data))
    print(incoming_changelog(code, ref), flush=True)
    overlaps = overridden_changes(code, root, base, ref)
    new = git(code, 'rev-parse', '--short', ref).strip()
    tag = subprocess.run(['git', '-C', str(code), 'describe', '--tags', '--exact-match', ref], capture_output=True, text=True)
    label = tag.stdout.strip() if tag.returncode == 0 else git(code, 'rev-parse', '--short', ref).strip()
    try:
        print(git(code, 'merge', '--no-edit', '-m', f'Update kit to {label}', ref), flush=True)
    except subprocess.CalledProcessError:
        conflicts = git(code, 'diff', '--name-only', '--diff-filter=U').splitlines()
        if conflicts and all(is_generated(f) for f in conflicts):
            # Generated skill files only: take the kit's copy; sync below rewrites them with local overrides.
            git(code, 'checkout', '--theirs', '--', *conflicts)
            git(code, 'add', '--', *conflicts)
            git(code, 'commit', '-q', '--no-edit')
        else:
            merge_head = Path(git(code, 'rev-parse', '--git-path', 'MERGE_HEAD').strip())
            if not merge_head.is_absolute():
                merge_head = code / merge_head
            if merge_head.exists():
                git(code, 'merge', '--abort')
            raise SystemExit('Kit merge failed; merge aborted. Conflicting files:\n' + ('\n'.join(conflicts) or '(none reported)'))
    env = {**os.environ, 'MASTER_REPO_ROOT': str(root)}
    subprocess.run([sys.executable, str(code / 'tools/migrate.py')], env=env, check=True)
    # Skill sync writes generated engine files only; separate private data must not be changed by sync.
    subprocess.run([sys.executable, str(code / 'tools/skills.py'), 'sync'], env={**env, 'MASTER_REPO_ROOT': str(code)}, check=True)
    generated = [f for f in git(code, 'status', '--porcelain=v1', '--untracked-files=all').splitlines() if is_generated(f[3:])]
    if generated:
        git(code, 'add', '-A', '--', *GENERATED)
        if git(code, 'rev-parse', 'HEAD').strip() == git(code, 'rev-parse', ref).strip():
            git(code, 'commit', '-q', '-m', 'Sync skills after kit update')  # fast-forward: never rewrite the kit's own commit
        else:
            git(code, 'commit', '-q', '--amend', '--no-edit')  # fold into the merge commit
    after = git(code, 'rev-parse', 'HEAD').strip()
    print(f'Kit {label}; hub {before[:12]} -> {after[:12]}; changed:\n' + ('\n'.join(incoming) or '(no engine changes)'))
    for f in overlaps:
        print(f'Your override local/{f} is kept; the kit changed {f} in this release. Compare: git diff {base[:7]}..{new} -- {f}')

if __name__ == '__main__':
    update()
