#!/usr/bin/env python3
"""Create a data directory without overwriting existing files."""
import argparse
import json
from pathlib import Path
import paths
import shlex
import subprocess
import sys
import shutil
import codebases
import pointer
from update import git, is_kit_checkout
from migrate import LATEST_VERSION


def initialize(root: Path, name: str, emails: list[str], handle: str, code: Path = paths.CODE, *, hub: str | None = None, code_dir: Path | None = None) -> list[str]:
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
    write('local/owner.json', json.dumps({'name': name, 'emails': emails, 'handles': [handle] if handle else [], 'hub': hub or root.name, 'code_dir': str((code_dir or default_code_dir()).expanduser().resolve())}, indent=2) + '\n')
    write('holding/direction.md', '---\ntitle: Direction\nwritten_by: agent\n---\n\n# Direction\n\n## Active conversations\n\nNo projects inventoried yet.\n')
    write('holding/schema.json', json.dumps({'version': LATEST_VERSION}, indent=2) + '\n')
    (root / 'companies').mkdir(parents=True, exist_ok=True)
    template = starter / 'companies/_template' if (starter / 'companies/_template').is_dir() else code / 'companies/_template'
    if template.is_dir():
        for source in template.rglob('*'):
            if source.is_file() and not source.is_symlink():
                write(Path('companies/_template') / source.relative_to(template), source.read_text())
    return created


def default_code_dir() -> Path:
    github = Path.home() / 'Documents/GitHub'
    return github if github.is_dir() else Path.home() / 'code'


def track_repos(root: Path, repos: list[dict]) -> tuple[list[str], list[str]]:
    created, slugs = [], []
    for repo in repos:
        slug = repo['slug']
        target = root / 'companies' / slug
        if not slug or slug.startswith('_') or target.exists() or target.is_symlink():
            print(f"Skipped {repo['name']}: project folder already exists or name is reserved")
            continue
        shutil.copytree(root / 'companies/_template', target, symlinks=True)
        company_file = target / 'company.json'
        company = json.loads(company_file.read_text())
        company.update(id=slug, name=repo['name'], repos=[{'path': repo['path']}])
        company_file.write_text(json.dumps(company, indent=2) + '\n')
        created.extend(str(p.relative_to(root)) for p in target.rglob('*') if p.is_file())
        slugs.append(slug)
    return created, slugs


def install_pointers(root: Path, slugs: list[str]) -> None:
    tpl = pointer.templates()
    for repo_path, projects in pointer.repo_slugs(root).items():
        if not set(projects).intersection(slugs):
            continue
        repo = Path(repo_path)
        # Init explicitly offers both agent files; existing import/symlink handling
        # remains the pointer tool's responsibility.
        for name in ('AGENTS.md', 'CLAUDE.md'):
            file = repo / name
            if not file.exists() and not file.is_symlink():
                file.touch()
        for file, want, have in pointer.plan(repo, projects, tpl, root=root):
            if want != have:
                file.write_text(want)
                print(f'Pointer changed: {file}')


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
    parser.add_argument('--hub')
    parser.add_argument('--code-dir')
    parser.add_argument('--repos', help='all, own, none, or comma-separated repo names')
    parser.add_argument('--pointers', choices=['yes', 'no'])
    parser.add_argument('--name')
    parser.add_argument('--email', action='append')
    parser.add_argument('--handle')
    parser.add_argument('--private-repo', metavar='OWNER/NAME')
    parser.add_argument('--commit', action='store_true')
    args = parser.parse_args()
    root = Path(args.dir).expanduser().resolve()
    prepare_remotes(root)
    existing = root / 'local/owner.json'
    owner = json.loads(existing.read_text()) if existing.exists() else {}
    interactive = sys.stdin.isatty()
    def ask(value, prompt, default):
        if value is not None:
            return value
        return (input(f'{prompt} [{default}]: ').strip() or default) if interactive else default
    hub = ask(args.hub, 'What do you want to call your hub?', owner.get('hub', root.name))
    name = ask(args.name, 'Name', owner.get('name', ''))
    emails = args.email if args.email is not None else [e.strip() for e in ask(None, 'Emails (comma-separated)', ','.join(owner.get('emails', []))).split(',') if e.strip()]
    handle = ask(args.handle, 'GitHub handle', next(iter(owner.get('handles', [])), ''))
    code_dir = Path(ask(args.code_dir, 'Where does your code live?', owner.get('code_dir', str(default_code_dir())))).expanduser().resolve()
    if args.code_dir is not None and not code_dir.is_dir():
        parser.error(f'code folder does not exist: {code_dir}')
    created = initialize(root, name, emails, handle, hub=hub, code_dir=code_dir)
    # Existing identity is deliberately preserved by initialize's no-overwrite rule.
    owner = json.loads(existing.read_text())
    hub = owner.get('hub', hub)
    repos = [codebases.scan_one(p.resolve(), {}, root=root, inventory=False)
             for p in sorted(code_dir.iterdir() if code_dir.is_dir() else [], key=lambda p: p.name.lower())
             if p.is_dir() and not p.name.startswith('.') and (p / '.git').exists() and p.resolve() != root]
    print(f'{hub}: local repos in {code_dir}')
    for repo in repos:
        print(f"  {repo['name']} ({repo['kind']})")
    selection = ask(args.repos, 'Which repos should be tracked? (all, own, none, or comma-separated names)', 'own')
    names = {n.strip() for n in selection.split(',') if n.strip()}
    if selection not in ('all', 'own', 'none') and names - {r['name'] for r in repos}:
        parser.error('unknown repo names: ' + ', '.join(sorted(names - {r['name'] for r in repos})))
    chosen = [r for r in repos if selection == 'all' or (selection == 'own' and r['kind'] == 'own') or (selection not in ('all', 'own', 'none') and r['name'] in names)]
    added, slugs = track_repos(root, chosen)
    created.extend(added)
    pointers = args.pointers
    if pointers is None:
        pointers = 'yes' if interactive and input("Add a short block to each repo's CLAUDE.md and AGENTS.md so their agents read the hub first? [y/N] ").strip().lower() in ('y', 'yes') else 'no'
    if pointers == 'yes':
        install_pointers(root, slugs)
    print(f'{hub}: created {len(created)} files in {root}')
    finish_setup(root, created, args.private_repo, args.commit)
    print(f'Next: open an agent in {hub} and choose a project to work on.')

if __name__ == '__main__':
    main()
