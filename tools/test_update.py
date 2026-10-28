from pathlib import Path
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).parent))
import pytest
import update


def git(root, *args):
    return subprocess.run(['git', '-C', str(root), *args], check=True, capture_output=True, text=True).stdout


def repository(root):
    git(root, 'init')
    git(root, 'config', 'user.email', 'test@example.test')
    git(root, 'config', 'user.name', 'Test')
    (root / 'tools').mkdir()
    (root / 'tools/demo.py').write_text('original')
    (root / 'local').mkdir()
    (root / 'local/owner.json').write_text('{}')
    git(root, 'add', '.')
    git(root, 'commit', '-m', 'fixture')


@pytest.mark.parametrize('staged', [False, True])
def test_refuses_tracked_local_engine_edits(tmp_path, staged):
    repository(tmp_path)
    (tmp_path / 'tools/demo.py').write_text('edited')
    if staged:
        git(tmp_path, 'add', 'tools/demo.py')
    with pytest.raises(SystemExit, match='tools/demo.py') as error:
        update.update(tmp_path, tmp_path)
    assert 'local/ overrides' in str(error.value)
    assert (tmp_path / 'tools/demo.py').read_text() == 'edited'


def test_data_edits_do_not_count_as_engine_edits(tmp_path):
    repository(tmp_path)
    (tmp_path / 'local/owner.json').write_text('{"name":"Dana"}')
    assert update.edited_engine_files(tmp_path) == []
    with pytest.raises(SystemExit, match='uncommitted tracked files'):
        update.update(tmp_path, tmp_path)


def test_update_fast_forwards_and_preserves_separate_data(tmp_path):
    source = tmp_path / 'source'; source.mkdir()
    repository(source)
    (source / 'kit.json').write_text('{}')
    (source / 'CHANGELOG.md').write_text('# Changes\n\n## 1\n\nFirst\n')
    (source / 'tools/migrate.py').write_text('import os\nfrom pathlib import Path\np=Path(os.environ["MASTER_REPO_ROOT"])/"migration-ran"\np.write_text("yes")\n')
    (source / 'tools/skills.py').write_text('import os\nfrom pathlib import Path\np=Path(os.environ["MASTER_REPO_ROOT"])/"skills-synced"\np.write_text("yes")\n')
    git(source, 'add', '.'); git(source, 'commit', '-m', 'kit fixture')
    checkout = tmp_path / 'checkout'
    subprocess.run(['git', 'clone', str(source), str(checkout)], check=True, capture_output=True)
    # A named kit remote need not have refs/remotes/kit/HEAD.
    git(checkout, 'remote', 'add', 'kit', str(source))
    (source / 'CHANGELOG.md').write_text('# Changes\n\n## 2\n\nNew release\n\n## 1\n\nFirst\n')
    git(source, 'add', '.'); git(source, 'commit', '-m', 'release')
    data = tmp_path / 'data'; data.mkdir()
    (data / 'private.json').write_text('{"kept":true}')
    update.update(checkout, data)
    assert git(checkout, 'rev-parse', 'HEAD') == git(source, 'rev-parse', 'HEAD')
    assert (data / 'private.json').read_text() == '{"kept":true}'
    assert (data / 'migration-ran').exists()
    assert not (data / 'skills-synced').exists()
    assert (checkout / 'skills-synced').exists()


def test_private_source_checkout_is_not_origin_kit(tmp_path):
    repository(tmp_path)
    (tmp_path / 'kit.json').write_text('{}')
    assert not update.is_kit_checkout(tmp_path)
    git(tmp_path, 'rm', 'local/owner.json')
    assert update.is_kit_checkout(tmp_path)
