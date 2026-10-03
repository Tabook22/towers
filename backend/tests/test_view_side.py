import io
import pytest
from sqlalchemy import create_engine, inspect
from fastapi import HTTPException
from pypdf import PdfReader

from app.migrations import rebuild_positions_table_for_multi_direction_support
from app.schemas import PositionUpdate, PositionCreate
from app.routers.positions import update_position
from app.services.position_labels import position_label
from app.services.pdf_form_reports import build_field_values, overflow_positions, build_starter_pdf_form, render_visit_report_pdf_form
from tests.test_visit_entry import db, files, make_visit, save, confirm, upload


@pytest.mark.parametrize('mount,direction', [('Suspension', 'NA'), ('Tension', 'Saada')])
def test_front_back_commit_independent_readings_images_and_report_rows(db, files, tmp_path, mount, direction):
    visit, user = make_visit(db)
    additions = [dict(id=key, ohl='OHL1', phase='R', string='S1', direction=direction,
        mount_type=mount, string_count='Single', view_side=side, tmax_c=temp, tref_c=20,
        screening_result='Hotspot detected', hotspot='Yes')
        for key, side, temp in [(-1, 'Front', 31), (-2, 'Back', 43)]]
    state = save(db, visit, user, {'additions': additions, 'layoutIds': [-1, -2],
        'layoutVersions': {str(p.id): p.updated_at.isoformat() for p in visit.positions}})
    upload(db, visit, user, -1, state['revision'])
    upload(db, visit, user, -2, state['revision'])
    result = confirm(db, visit, user, state['revision'])
    rows = {p.view_side: p for p in result.positions if p.in_scope}
    assert set(rows) == {'Front', 'Back'}
    assert rows['Front'].tmax_c == 31 and rows['Back'].tmax_c == 43
    assert rows['Front'].delta_t == 11 and rows['Back'].delta_t == 23
    assert rows['Front'].id != rows['Back'].id
    front_image = next(i for i in rows['Front'].images if i.file_path)
    back_image = next(i for i in rows['Back'].images if i.file_path)
    assert front_image.id != back_image.id and front_image.file_path != back_image.file_path
    assert front_image.image_code != back_image.image_code
    assert 'Front' in front_image.image_code and 'Back' in back_image.image_code
    assert result.rollup.possible_positions == result.rollup.screened == 2
    db.refresh(visit)
    active = [p for p in visit.positions if p.in_scope]
    assert {position_label(p).split(' / ')[0] for p in active} == {'Front view', 'Back view'}
    assert len(overflow_positions(visit)) == 1
    values = build_field_values(visit)
    assert any('Front view' in str(v) or 'Back view' in str(v) for v in values.values())
    template = tmp_path / 'form.pdf'; template.write_bytes(build_starter_pdf_form())
    report = PdfReader(io.BytesIO(render_visit_report_pdf_form(visit, template)))
    assert len(report.pages) > len(PdfReader(template).pages)
    assert any('view' in (page.extract_text() or '') for page in report.pages)
    with pytest.raises(HTTPException) as error:
        update_position(rows['Back'].id, PositionUpdate(view_side='Front'), db, user)
    assert error.value.status_code == 409
    db.rollback()


def test_view_values_are_validated_and_omitted_updates_do_not_relabel_history():
    assert PositionUpdate(tmax_c=35).model_dump(exclude_unset=True) == {'tmax_c': 35}
    assert PositionCreate(ohl='OHL1', phase='R', string='S1', direction='Saada').view_side == 'Unspecified'
    for bad in [None, '', 'Sideways']:
        with pytest.raises(ValueError):
            PositionUpdate(view_side=bad)


def test_sqlite_migration_preserves_ids_readings_foreign_keys_and_is_repeatable(tmp_path):
    engine = create_engine('sqlite:///' + str(tmp_path / 'legacy.sqlite3'))
    with engine.begin() as conn:
        conn.exec_driver_sql('PRAGMA foreign_keys=ON')
        conn.exec_driver_sql('CREATE TABLE visits (id INTEGER PRIMARY KEY)')
        conn.exec_driver_sql('INSERT INTO visits VALUES (7)')
        conn.exec_driver_sql('''CREATE TABLE positions (
            id INTEGER PRIMARY KEY, visit_id INTEGER REFERENCES visits(id), ohl TEXT,
            phase TEXT, string TEXT, direction TEXT, installed BOOLEAN NOT NULL,
            screening_result TEXT NOT NULL, tmax_c FLOAT, tref_c FLOAT, position_code TEXT,
            created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
            CONSTRAINT uq_position_slot UNIQUE(visit_id, ohl, phase, string, direction))''')
        conn.exec_driver_sql("INSERT INTO positions VALUES (19,7,'OHL1','R','S1','Saada',1,'Normal',35,25,'old-code','2026-01-01','2026-01-01')")
        conn.exec_driver_sql('CREATE TABLE images (id INTEGER PRIMARY KEY, position_id INTEGER REFERENCES positions(id), file_path TEXT)')
        conn.exec_driver_sql("INSERT INTO images VALUES (23,19,'original.jpg')")
    rebuild_positions_table_for_multi_direction_support(engine)
    rebuild_positions_table_for_multi_direction_support(engine)
    with engine.connect() as conn:
        assert conn.exec_driver_sql('PRAGMA foreign_keys').scalar() == 1
        assert not conn.exec_driver_sql('PRAGMA foreign_key_check').fetchall()
        assert tuple(conn.exec_driver_sql('SELECT id,tmax_c,tref_c,view_side,position_code FROM positions').one()) == (19,35,25,'Unspecified','old-code')
        assert tuple(conn.exec_driver_sql('SELECT id,position_id,file_path FROM images').one()) == (23,19,'original.jpg')
        assert inspect(conn).get_foreign_keys('images')[0]['referred_table'] == 'positions'
        assert 'view_side' in inspect(conn).get_unique_constraints('positions')[0]['column_names']
    engine.dispose()
