import pytest
from sqlalchemy import create_engine, inspect

from app.migrations import repair_obsolete_position_foreign_keys


@pytest.mark.parametrize('enabled', [False, True])
def test_obsolete_links_repair_preserves_custom_columns_indexes_and_detached_drafts(tmp_path, enabled):
    engine = create_engine('sqlite:///' + str(tmp_path / 'old.sqlite3'))
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE positions (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('INSERT INTO positions VALUES (12)')
        for name in ('images', 'visit_photos'):
            conn.exec_driver_sql(f'CREATE TABLE {name} (id INTEGER PRIMARY KEY, position_id INTEGER REFERENCES "positions_old"(id), original_value BLOB)')
            conn.exec_driver_sql(f'CREATE INDEX ix_{name}_original ON {name}(original_value)')
            conn.exec_driver_sql(f'INSERT INTO {name} VALUES (1,12,?)', (b'original\x00bytes',))
        conn.exec_driver_sql('CREATE TABLE visits (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('CREATE TABLE visit_entry_drafts (id INTEGER PRIMARY KEY, visit_id INTEGER REFERENCES visits(id), payload TEXT)')
        conn.exec_driver_sql("INSERT INTO visit_entry_drafts VALUES (3,999,'retained private payload')")
    with engine.connect() as conn:
        conn.exec_driver_sql(f'PRAGMA foreign_keys={int(enabled)}'); conn.commit()
    repair_obsolete_position_foreign_keys(engine)
    repair_obsolete_position_foreign_keys(engine)
    with engine.connect() as conn:
        assert conn.exec_driver_sql('PRAGMA foreign_keys').scalar() == int(enabled)
        assert conn.exec_driver_sql('PRAGMA foreign_key_check').fetchall() == [('visit_entry_drafts', 3, 'visits', 0)]
        for name in ('images', 'visit_photos'):
            assert tuple(conn.exec_driver_sql(f'SELECT * FROM {name}').one()) == (1,12,b'original\x00bytes')
            assert inspect(conn).get_foreign_keys(name)[0]['referred_table'] == 'positions'
            assert inspect(conn).get_indexes(name)[0]['name'] == f'ix_{name}_original'
        assert conn.exec_driver_sql('SELECT payload FROM visit_entry_drafts').scalar() == 'retained private payload'
    engine.dispose()


def test_unresolved_evidence_aborts_both_repairs_atomically(tmp_path):
    engine = create_engine('sqlite:///' + str(tmp_path / 'broken.sqlite3'))
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE positions (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('INSERT INTO positions VALUES (12)')
        for name, position_id in [('images', 12), ('visit_photos', 999)]:
            conn.exec_driver_sql(f'CREATE TABLE {name} (id INTEGER PRIMARY KEY, position_id INTEGER REFERENCES positions_old(id))')
            conn.exec_driver_sql(f'INSERT INTO {name} VALUES (1,{position_id})')
    with pytest.raises(RuntimeError, match='unresolved position IDs'):
        repair_obsolete_position_foreign_keys(engine)
    with engine.connect() as conn:
        for name in ('images', 'visit_photos'):
            assert inspect(conn).get_foreign_keys(name)[0]['referred_table'] == 'positions_old'
        assert not any('fk_repair' in table for table in inspect(conn).get_table_names())
    engine.dispose()
