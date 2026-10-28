import importlib.util
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
import init
from migrate import LATEST_VERSION


def test_init_and_no_overwrite(tmp_path):
    code = tmp_path / 'code'
    template = code / 'companies/_template'
    template.mkdir(parents=True)
    (template / 'company.json').write_text('{"id": ""}')
    root = tmp_path / 'data'
    created = init.initialize(root, 'Dana', ['dana@example.test'], 'dana', code)
    assert len(created) == 4
    assert json.loads((root / 'holding/schema.json').read_text())['version'] == LATEST_VERSION
    assert '## Active conversations' in (root / 'holding/direction.md').read_text()
    assert json.loads((root / 'local/owner.json').read_text())['handles'] == ['dana']
    (root / 'holding/direction.md').write_text('keep mine')
    assert init.initialize(root, 'Other', [], '', code) == []
    assert (root / 'holding/direction.md').read_text() == 'keep mine'
    assert json.loads((root / 'local/owner.json').read_text())['name'] == 'Dana'


def test_starter_takes_precedence(tmp_path):
    starter = tmp_path / 'code/kit/starter/holding'
    starter.mkdir(parents=True)
    (starter / 'direction.md').write_text('starter\n## Active conversations\n')
    init.initialize(tmp_path / 'data', 'Dana', [], '', tmp_path / 'code')
    assert (tmp_path / 'data/holding/direction.md').read_text().startswith('starter')


def test_private_remote_requires_explicit_flag(tmp_path, monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(init.subprocess, 'run', lambda command, **kwargs: calls.append(command))
    monkeypatch.setattr(init, 'git', lambda root, *args: calls.append(list(args)) or ('local/owner.json' if args[:2] == ('diff', '--cached') else ''))
    init.finish_setup(tmp_path, ['local/owner.json'], None, False)
    assert calls == []
    output = capsys.readouterr().out
    assert 'gh repo create' in output and '--private' in output and 'push -u origin HEAD' in output
    init.finish_setup(tmp_path, ['local/owner.json'], 'person/hq', False)
    assert calls[0][:4] == ['gh', 'repo', 'create', 'person/hq']
    assert ['commit', '-m', 'Set up hub', '--', 'local/owner.json'] in calls
    assert calls[-1][-4:] == ['push', '-u', 'origin', 'HEAD']


def test_existing_other_origin_is_preserved(tmp_path):
    import subprocess
    subprocess.run(['git', 'init', str(tmp_path)], check=True, capture_output=True)
    init.git(tmp_path, 'remote', 'add', 'origin', 'https://example.com/person/private-hub')
    (tmp_path / 'kit.json').write_text('{}')
    init.prepare_remotes(tmp_path)
    assert init.git(tmp_path, 'remote').strip() == 'origin'


def test_noninteractive_repos_and_pointers(tmp_path, monkeypatch, capsys):
    import subprocess
    import codebases
    home = tmp_path / 'home'
    home.mkdir()
    monkeypatch.setenv('HOME', str(home))
    code_dir = home / 'code'
    code_dir.mkdir()
    for name, owner in [('Own App', 'dana'), ('clone', 'someone-else')]:
        repo = code_dir / name
        subprocess.run(['git', 'init', str(repo)], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(repo), 'remote', 'add', 'origin',
                        f'https://github.com/{owner}/{name.replace(" ", "-")}.git'], check=True)
    root = tmp_path / 'hub'
    args = ['init.py', str(root), '--hub', 'Workshop', '--name', 'Dana',
            '--email', 'dana@example.test', '--handle', 'dana', '--code-dir', str(code_dir),
            '--repos', 'own', '--pointers', 'yes']
    monkeypatch.setattr(sys, 'argv', args)
    init.main()
    owner = json.loads((root / 'local/owner.json').read_text())
    assert owner['hub'] == 'Workshop'
    assert owner['code_dir'] == str(code_dir)
    assert codebases.code_folder(root) == code_dir
    project = root / 'companies/own-app'
    company = json.loads((project / 'company.json').read_text())
    assert company['id'] == 'own-app' and company['name'] == 'Own App'
    assert company['repos'] == [{'path': str(code_dir / 'Own App')}]
    assert not (root / 'companies/clone').exists()
    for name in ['AGENTS.md', 'CLAUDE.md', 'MASTER-REPO.md']:
        text = (code_dir / 'Own App' / name).read_text()
        assert 'Workshop' in text and str(root) in text
    assert not (code_dir / 'clone/MASTER-REPO.md').exists()
    assert not list(code_dir.glob('*/.git/refs/heads/*'))
    output = capsys.readouterr().out
    assert 'clone (clone)' in output and 'Own App (own)' in output
    assert 'Pointer changed:' in output
    (project / 'company.json').write_text('{"keep": true}')
    init.main()
    assert json.loads((project / 'company.json').read_text()) == {'keep': True}


def test_selection_and_default_no_pointers(tmp_path, monkeypatch):
    import subprocess
    code_dir = tmp_path / 'code'
    code_dir.mkdir()
    subprocess.run(['git', 'init', str(code_dir / 'demo')], check=True, capture_output=True)
    for selection, expected in [('none', False), ('all', True), ('demo', True)]:
        root = tmp_path / selection
        monkeypatch.setattr(sys, 'argv', ['init.py', str(root), '--name', 'Dana', '--handle', 'dana',
                                         '--code-dir', str(code_dir), '--repos', selection])
        init.main()
        assert (root / 'companies/demo/company.json').exists() == expected
        assert not (code_dir / 'demo/MASTER-REPO.md').exists()
