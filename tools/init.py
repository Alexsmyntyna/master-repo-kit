#!/usr/bin/env python3
"""Create a data directory without overwriting existing files."""
import argparse
import json
from pathlib import Path
import paths
import shlex
import subprocess
from update import git, is_kit_checkout
from migrate import LATEST_VERSION


def initialize(root: Path, name: str, emails: list[str], handle: str, code: Path = paths.CODE) -> list[str]:
    root = root.expanduser().resolve()
    created = []
    def write(relative, text):
        file = root / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        try:
            with file.open('x') as out:
                out.write(text)
            created.append(str(relative))
        except FileExistsError:
            pass
    starter = code / 'kit/starter'
    if starter.is_dir():
        for source in sorted(starter.rglob('*')):
            if source.is_file() and not source.is_symlink() and source.relative_to(starter).as_posix() not in ('local/owner.json', 'holding/schema.json'):
                target = root / source.relative_to(starter)
                target.parent.mkdir(parents=True, exist_ok=True)
                try:
                    with target.open('xb') as out:
                        out.write(source.read_bytes())
                    created.append(str(target.relative_to(root)))
                except FileExistsError:
                    pass
    write('local/owner.json', json.dumps({'name': name, 'emails': emails, 'handles': [handle] if handle else []}, indent=2) + '\n')
    write('holding/direction.md', '---\ntitle: Direction\nwritten_by: agent\n---\n\n# Direction\n\n## Active conversations\n\nNo projects inventoried yet.\n')
    write('holding/schema.json', json.dumps({'version': LATEST_VERSION}, indent=2) + '\n')
    (root / 'companies').mkdir(parents=True, exist_ok=True)
    template = starter / 'companies/_template' if (starter / 'companies/_template').is_dir() else code / 'companies/_template'
    if template.is_dir():
        for source in template.rglob('*'):
            if source.is_file() and not source.is_symlink():
                write(Path('companies/_template') / source.relative_to(template), source.read_text())
    return created


def prepare_remotes(root: Path) -> None:
    if not (root / '.git').exists():
        return
    remotes = git(root, 'remote').splitlines()
    if 'origin' in remotes and 'kit' not in remotes:
        url = git(root, 'remote', 'get-url', 'origin').strip()
        # Local clone sources can have arbitrary directory names. Check their
        # engine/data boundary too; a different private hub must keep origin.
        local_source = Path(url).expanduser()
        same_kit = (is_kit_checkout(root) and local_source.is_dir()
                    and (local_source / '.git').exists() and is_kit_checkout(local_source))
        if 'master-repo-kit' in url or same_kit:
            git(root, 'remote', 'rename', 'origin', 'kit')
            print('Renamed origin -> kit')


def finish_setup(root: Path, created: list[str], private_repo: str | None, commit: bool) -> None:
    command = ['gh', 'repo', 'create', private_repo or '<you>/hq', '--private', '--source', str(root), '--remote', 'origin']
    if private_repo:
        subprocess.run(command, check=True)
    else:
        print('Private remote: ' + shlex.join(command))
    if private_repo or commit:
        if created:
            git(root, 'add', '--', *created)
        if created and git(root, 'diff', '--cached', '--name-only', '--', *created).strip():
            git(root, 'commit', '-m', 'Set up hub', '--', *created)
    else:
        print('Commit data: ' + shlex.join(['git', '-C', str(root), 'add', '--', *created]))
        print('Then: ' + shlex.join(['git', '-C', str(root), 'commit', '-m', 'Set up hub']))
    push = ['git', '-C', str(root), 'push', '-u', 'origin', 'HEAD']
    if private_repo:
        subprocess.run(push, check=True)
    else:
        print('Push: ' + shlex.join(push))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dir', nargs='?', default=str(paths.CODE))
    parser.add_argument('--name')
    parser.add_argument('--email', action='append')
    parser.add_argument('--handle')
    parser.add_argument('--private-repo', metavar='OWNER/NAME')
    parser.add_argument('--commit', action='store_true')
    args = parser.parse_args()
    root = Path(args.dir).expanduser().resolve()
    prepare_remotes(root)
    existing = Path(args.dir).expanduser() / 'local/owner.json'
    name = args.name if args.name is not None else ('' if existing.exists() else input('Name: ').strip())
    emails = args.email if args.email is not None else ([] if existing.exists() else [e.strip() for e in input('Emails (comma-separated): ').split(',') if e.strip()])
    handle = args.handle if args.handle is not None else ('' if existing.exists() else input('GitHub handle: ').strip())
    created = initialize(Path(args.dir), name, emails, handle)
    print(f'Created {len(created)} files in {Path(args.dir).expanduser().resolve()}')
    finish_setup(root, created, args.private_repo, args.commit)
    print('Next: open an agent here and say: inventory my repos (github-discovery skill).')

if __name__ == '__main__':
    main()
