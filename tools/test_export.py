"""Public kit boundaries and leak detection, using isolated repositories."""
import json
from pathlib import Path
import subprocess

import pytest

try:
    from . import export
except ImportError:
    import export


@pytest.fixture
def repo(tmp_path):
    code = tmp_path / 'repo'
    code.mkdir()
    subprocess.run(['git', 'init', '-q', str(code)], check=True)
    def write(name, text):
        file = code / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)
    write('local/owner.json', json.dumps({'name': 'Casey Sample', 'short': 'Caz',
                                        'emails': ['casey@private.test'], 'handles': ['caseyhandle']}))
    write('companies/widget/company.json', '{"name": "Widget Works"}')
    write('companies/master-repo-kit/company.json', '{"name": "Master-Repo"}')
    write('local/owner.md', 'Path: `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Vault`.')
    write('app/readme.md', 'CASEY Widget Works caseyhandle casey@private.test\n')
    write('tools/ok.py', 'print("hello")\n')
    write('.gitignore', 'app/ignored.txt\n')
    write('app/ignored.txt', 'ignored')
    write('app/.env.example', 'never')
    write('app/node_modules/a', 'never')
    write('local/owner.example.json', '{}')
    write('companies/_template/company.json', '{}')
    write('kit/starter/demo.md', 'starter')
    config = {'include': ['app/', 'tools/', 'companies/', 'local/', 'kit/'], 'exclude': [], 'allow': []}
    return code, config


def test_export_allowlist_and_git_ignore(repo, tmp_path):
    code, config = repo
    out = tmp_path / 'out'
    export.export_tree(code, out, config)
    assert {f.relative_to(out).as_posix() for f in out.rglob('*') if f.is_file()} == {
        'app/readme.md', 'tools/ok.py', 'local/owner.example.json',
        'companies/_template/company.json', 'kit/starter/demo.md'}


def test_target_protection_and_force(repo, tmp_path):
    code, config = repo
    out = tmp_path / 'out'
    out.mkdir()
    (out / 'old').write_text('old')
    with pytest.raises(ValueError):
        export.export_tree(code, out, config)
    export.export_tree(code, out, config, True)
    assert not (out / 'old').exists()
    with pytest.raises(ValueError):
        export.export_tree(code, code, config, True)


def test_scanner_categories_boundaries_and_binary(repo, tmp_path):
    code, config = repo
    out = tmp_path / 'out'
    out.mkdir()
    (out / 'leak').write_text('CASEY Caz caseyhandle Widget widget works\n'
                              '/Users/someone/file ~/Library/Mobile Documents\n'
                              'user@private.test user@example.com noreply@service.test\n'
                              + 'sk-' + 'x' * 24 + '\n'
                              + 'ghp_' + 'x' * 30 + '\n'
                              + 'AKIA' + 'X' * 16 + '\n-----BEGIN\n'
                              'Caseyish Master-Repo')
    (out / 'binary').write_bytes(b'\xff\x00caseyhandle casey@private.test')
    leaks, count, size = export.scan_tree(out, code, config)
    assert count == 2 and size > 0
    assert {l.category for l in leaks} == {'owner', 'project', 'home-path', 'email', 'secret'}
    assert sum(l.category == 'secret' for l in leaks) == 4
    assert any(l.file == 'binary' and l.category == 'owner' for l in leaks)
    assert not any(l.match in {'Caseyish', 'Master-Repo', 'user@example.com', 'noreply@service.test'} for l in leaks)


def test_exact_exception_requires_reason(repo, tmp_path):
    code, config = repo
    out = tmp_path / 'out'
    out.mkdir()
    (out / 'a').write_text('Casey')
    (out / 'b').write_text('Casey')
    config['allow'] = [{'file': 'a', 'pattern': 'Casey', 'reason': 'fixture'}]
    assert [l.file for l in export.scan_tree(out, code, config)[0]] == ['b']
    (code / 'kit.json').write_text(json.dumps(config))
    export.manifest(code)
    config['allow'][0]['reason'] = ''
    (code / 'kit.json').write_text(json.dumps(config))
    with pytest.raises(ValueError):
        export.manifest(code)


def test_symlink_refused(repo, tmp_path):
    code, config = repo
    (code / 'app/link').symlink_to(code / 'local/owner.json')
    with pytest.raises(ValueError, match='symlink'):
        export.export_tree(code, tmp_path / 'out', config)


def test_check_and_scan_do_not_write(repo, tmp_path, monkeypatch, capsys):
    code, config = repo
    (code / 'kit.json').write_text(json.dumps(config))
    monkeypatch.setattr(export.paths, 'CODE', code)
    monkeypatch.setattr(export.paths, 'ROOT', code)
    out = tmp_path / 'out'
    out.mkdir()
    (out / 'leak').write_text('Casey')
    assert export.main([str(out), '--check']) == 1
    assert export.main(['scan', str(out)]) == 1
    assert list(out.iterdir()) == [out / 'leak']
    (out / 'leak').write_text('safe')
    assert export.main(['scan', str(out)]) == 0
    assert 'leaks: 0' in capsys.readouterr().out


def test_public_root_layout_and_starter(repo, tmp_path):
    code, config = repo
    for name in ('README.md', 'LICENSE', 'CHANGELOG.md'):
        (code / 'kit' / name).write_text('public ' + name)
    (code / 'README.md').write_text('private readme')
    (code / 'kit/CLAIMS.md').write_text('private working notes')
    config['include'].append('README.md')
    config['exclude'].append('kit/CLAIMS.md')
    config['copy'] = {f'kit/{name}': name for name in ('README.md', 'LICENSE', 'CHANGELOG.md')}
    out = tmp_path / 'out'
    export.export_tree(code, out, config)
    assert (out / 'README.md').read_text() == 'public README.md'
    assert (out / 'LICENSE').is_file()
    assert (out / 'CHANGELOG.md').is_file()
    assert (out / 'kit/starter/demo.md').is_file()
    assert not (out / 'kit/CLAIMS.md').exists()


def test_file_mentions_are_not_emails(repo, tmp_path):
    code, config = repo
    out = tmp_path / 'out'
    out.mkdir()
    (out / 'refs').write_text('`@AGENTS.md` x@AGENTS.md user@contact.test')
    emails = [leak.match for leak in export.scan_tree(out, code, config)[0] if leak.category == 'email']
    assert emails == ['user@contact.test']


def test_ignored_project_terms_do_not_hide_owner_identity(repo, tmp_path):
    code, config = repo
    (code / 'companies/ordinary').mkdir()
    (code / 'companies/ordinary/company.json').write_text('{"name": "Ordinary"}')
    config['ignore_terms'] = [{'term': 'ordinary', 'reason': 'Common word in module examples'}]
    out = tmp_path / 'out'
    out.mkdir()
    (out / 'text').write_text('ordinary Casey Widget')
    leaks = export.scan_tree(out, code, config)[0]
    assert {(leak.category, leak.match) for leak in leaks} == {('owner', 'Casey'), ('project', 'Widget')}
