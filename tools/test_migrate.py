"""Migration behavior is exercised only against disposable data directories."""
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
import pytest
import migrate
import converse
import card


def fixture(root):
    d = root / 'companies/demo/threads/topic'
    d.mkdir(parents=True)
    (d / '001-alex.md').write_text('---\nfrom: "alex"\nto: coo\nwritten_by: alex\n---\n\nAda said hello; see 001-alex.md\n')
    (d / 'thread.md').write_text('---\nstatus: awaiting-alex\nparticipants: ["alex", "coo"]\n---\n\n001-alex.md\n')
    (root / 'companies/demo/card.json').write_text(json.dumps({'kind_source': 'alex', 'source': 'alex', 'owned_by_alex': True, 'ref': '001-alex.md', 'name': 'Ada', 'nested': {'raised_by': 'alex'}}))
    return d


def snapshot(root):
    return {str(f.relative_to(root)): f.read_bytes() for f in root.rglob('*') if f.is_file()}


def test_dry_run_and_idempotence(tmp_path):
    fixture(tmp_path)
    before = snapshot(tmp_path)
    result = migrate.migrate(tmp_path, True)
    assert snapshot(tmp_path) == before
    assert result['renamed'] == 1 and result['values'] >= 5
    applied = migrate.migrate(tmp_path)
    assert applied['files'] == result['files']
    assert migrate.version(tmp_path) == 2
    after = snapshot(tmp_path)
    assert migrate.migrate(tmp_path)['from'] == 2
    assert snapshot(tmp_path) == after
    data = json.loads((tmp_path / 'companies/demo/card.json').read_text())
    assert data['source'] == data['kind_source'] == 'owner'
    assert data['owned_by_owner'] is True and data['name'] == 'Ada'
    assert 'Ada said hello' in (tmp_path / 'companies/demo/threads/topic/001-owner.md').read_text()


@pytest.mark.parametrize('migrated', [False, True])
def test_old_and_new_threads_read_and_new_writes(tmp_path, monkeypatch, migrated):
    thread = fixture(tmp_path)
    monkeypatch.setattr(converse, 'ROOT', tmp_path)
    monkeypatch.setattr(card, 'ROOT', tmp_path)
    if migrated:
        migrate.migrate(tmp_path)
    assert converse.page_of(thread) == {}
    assert card.owes("demo", tmp_path)["threads_awaiting"] == 1
    file = converse.add_message(thread, 'coo', 'alex', 'decision', 'Choose this.')
    assert file.name == '002-coo.md'
    meta, _ = converse.split_frontmatter(file.read_text())
    assert meta['to'] == 'owner'
    assert converse.read_thread(thread)[0]['status'] == 'awaiting-owner'
    file = converse.add_message(thread, 'alex', 'coo', 'reply', 'Go.')
    assert file.name == '003-owner.md'


def test_collision_refuses_before_writes(tmp_path):
    d = fixture(tmp_path)
    (d / '001-owner.md').write_text('existing')
    before = snapshot(tmp_path)
    with pytest.raises(ValueError, match='collision'):
        migrate.migrate(tmp_path)
    assert snapshot(tmp_path) == before


def test_unknown_schema_refused(tmp_path):
    (tmp_path / 'holding').mkdir()
    (tmp_path / 'holding/schema.json').write_text('{"version": 99}')
    with pytest.raises(ValueError, match='newer'):
        migrate.migrate(tmp_path)


def test_root_via_symlink_is_supported(tmp_path):
    actual = tmp_path / 'actual'
    fixture(actual)
    alias = tmp_path / 'alias'
    alias.symlink_to(actual, target_is_directory=True)
    result = migrate.migrate(alias)
    assert result['renamed'] == 1
    assert (actual / 'companies/demo/threads/topic/001-owner.md').exists()
