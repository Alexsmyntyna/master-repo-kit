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
