"""Release and hub history use only temporary repositories and local bare remotes."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

import pytest
import export
import init
import update


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True).stdout.strip()


def identity(root):
    git(root, 'config', 'user.name', 'Test')
    git(root, 'config', 'user.email', 'test@example.com')


@pytest.fixture
def lifecycle(tmp_path):
    code = tmp_path / 'engine'; code.mkdir()
    git(code, 'init', '-b', 'main')
    (code / 'tools').mkdir()
    for name in ('init.py', 'update.py', 'paths.py', 'migrate.py', 'skills.py', 'codebases.py', 'pointer.py'):
        shutil.copy2(Path(__file__).parent / name, code / 'tools' / name)
    (code / 'tools/demo.py').write_text('first\n')
    (code / 'skills').mkdir()
    (code / 'skills/demo.md').write_text('---\nname: demo\ntitle: Demo\nkind: task\nwhen: testing\nstatus: ready\n---\nShipped one.\n')
    (code / 'CHANGELOG.md').write_text('# Changes\n\n## 0.1.0\nFirst\n')
    (code / '.gitignore').write_text('__pycache__/\n*.pyc\n')
    config = {'include': ['tools/', 'skills/', 'CHANGELOG.md', 'kit.json', '.gitignore'], 'allow': [], 'exclude': []}
    (code / 'kit.json').write_text(json.dumps(config))
    release = tmp_path / 'release'; release.mkdir()
    git(release, 'init', '-b', 'main'); identity(release)
    kit_remote = tmp_path / 'master-repo-kit.git'
    subprocess.run(['git', 'init', '--bare', '-b', 'main', str(kit_remote)], check=True, capture_output=True)
    git(release, 'remote', 'add', 'origin', str(kit_remote))
    export.release(code, code, release, '0.1.0', config)
    git(release, 'push', 'origin', 'main', '--tags')
    hub = tmp_path / 'hq'
    subprocess.run(['git', 'clone', str(kit_remote), str(hub)], check=True, capture_output=True)
    identity(hub)
    subprocess.run([sys.executable, str(hub / 'tools/init.py'), '--name', 'Test', '--email', 'test@example.com', '--handle', 'test', '--code-dir', str(code), '--repos', 'none', '--commit'], check=True, capture_output=True)
    assert git(hub, 'remote') == 'kit'
    private = tmp_path / 'private.git'
    subprocess.run(['git', 'init', '--bare', '-b', 'main', str(private)], check=True, capture_output=True)
    git(hub, 'remote', 'add', 'origin', str(private))
    (hub / 'companies/demo').mkdir(parents=True)
    (hub / 'companies/demo/company.json').write_text('{"name":"Demo"}')
    (hub / 'local/skills').mkdir()
    override = '---\nname: demo\ntitle: Demo\nkind: task\nwhen: testing\nstatus: ready\n---\nKeep this override.\n'
    (hub / 'local/skills/demo.md').write_text(override)
    git(hub, 'add', '.'); git(hub, 'commit', '-m', 'My project and skill')
    user_commit = git(hub, 'rev-parse', 'HEAD')
    git(hub, 'push', '-u', 'origin', 'HEAD')
    (code / 'tools/demo.py').write_text('second\n')
    (code / 'skills/demo.md').write_text('---\nname: demo\ntitle: Demo\nkind: task\nwhen: testing\nstatus: ready\n---\nShipped two.\n')
    (code / 'tools/neutral.py').write_text('# no data migration\n')
    (code / 'CHANGELOG.md').write_text('# Changes\n\n## 0.1.1\nSecond\n\n## 0.1.0\nFirst\n')
    export.release(code, code, release, '0.1.1', config)
    release_commit = git(release, 'rev-parse', 'HEAD')
    git(release, 'push', 'origin', 'main', '--tags')
    return hub, release, user_commit, release_commit, override


def test_release_init_update_history(lifecycle, capsys):
    hub, release, user_commit, release_commit, override = lifecycle
    update.update(hub, hub)
    assert (hub / 'tools/demo.py').read_text() == 'second\n'
    assert (hub / 'companies/demo/company.json').read_text() == '{"name":"Demo"}'
    assert (hub / 'local/skills/demo.md').read_text() == override
    git(hub, 'merge-base', '--is-ancestor', user_commit, 'HEAD')
    git(hub, 'merge-base', '--is-ancestor', release_commit, 'HEAD')
    assert git(hub, 'tag', '--list', 'v0.1.1') == 'v0.1.1'
    assert git(hub, 'show', '-s', '--format=%s', 'HEAD') == 'Update kit to v0.1.1'
    out = capsys.readouterr().out
    assert 'Incoming CHANGELOG.md:' in out
    assert 'Your override local/skills/demo.md is kept; the kit changed skills/demo.md in this release. Compare: git diff ' in out
    assert json.loads((hub / 'kit.json').read_text())['version'] == '0.1.1'


def test_committed_engine_edit_refused(lifecycle):
    hub, *_ = lifecycle
    (hub / 'tools/demo.py').write_text('custom\n')
    git(hub, 'add', '.'); git(hub, 'commit', '-m', 'Engine customization')
    before = git(hub, 'rev-parse', 'HEAD')
    with pytest.raises(SystemExit, match='local/ overrides') as error:
        update.update(hub, hub)
    assert 'tools/demo.py' in str(error.value)
    assert git(hub, 'rev-parse', 'HEAD') == before


def test_conflict_aborts_cleanly(lifecycle):
    hub, release, *_ = lifecycle
    # Committed engine edits are normally refused before merge. Bypass only
    # that guard's diff for this rollback test; git performs the real conflict.
    (hub / 'tools/demo.py').write_text('conflicting local text\n')
    git(hub, 'add', '.'); git(hub, 'commit', '-m', 'Conflict fixture')
    before = git(hub, 'rev-parse', 'HEAD')
    with pytest.MonkeyPatch.context() as patch:
        real_git = update.git
        def filtered(root, *args):
            result = real_git(root, *args)
            if args[:2] == ('diff', '--name-only') and args[-1] == 'HEAD':
                return '\n'.join(n for n in result.splitlines() if n != 'tools/demo.py')
            return result
        patch.setattr(update, 'git', filtered)
        with pytest.raises(SystemExit, match='merge aborted') as error:
            update.update(hub, hub)
    assert 'tools/demo.py' in str(error.value)
    assert git(hub, 'rev-parse', 'HEAD') == before
    assert not (hub / '.git/MERGE_HEAD').exists()
    assert git(hub, 'status', '--porcelain') == ''


def test_release_removes_old_files_and_keeps_history(lifecycle, tmp_path):
    hub, release, _, previous, _ = lifecycle
    code = tmp_path / 'engine'
    (code / 'tools/neutral.py').unlink()
    config = json.loads((code / 'kit.json').read_text())
    export.release(code, code, release, '0.1.2', config)
    assert not (release / 'tools/neutral.py').exists()
    git(release, 'merge-base', '--is-ancestor', previous, 'HEAD')
    assert git(release, 'cat-file', '-t', 'v0.1.2') == 'tag'


def test_release_leak_does_not_modify_checkout(lifecycle, tmp_path):
    _, release, _, previous, _ = lifecycle
    code = tmp_path / 'engine'
    (code / 'tools/leak.py').write_text('private' + '@' + 'secret.test')
    config = json.loads((code / 'kit.json').read_text())
    with pytest.raises(ValueError, match='leak scan failed'):
        export.release(code, code, release, '0.1.2', config)
    assert git(release, 'rev-parse', 'HEAD') == previous
    assert git(release, 'status', '--porcelain') == ''
