import io
import pytest
from pypdf import PdfReader
from fastapi import HTTPException
from app.schemas import PositionCreate, PositionUpdate
from app.routers.positions import update_position
from app.services.id_gen import image_sequence_number
from app.services.pdf_form_reports import build_field_values, build_starter_pdf_form, overflow_positions, render_visit_report_pdf_form
from app.services.oetc_report import _measurement_context
from tests.test_visit_entry import db, files, make_visit, save, confirm, upload, patch


def test_suspension_without_direction_commits_reading_and_image(db, files):
    visit, user = make_visit(db)
    pos = visit.positions[0]
    state = save(db, visit, user, {'drafts': {str(pos.id): patch(pos, mount_type='Suspension',
        string_count='Single', direction='NA', tmax_c=35, tref_c=27)},
        'layoutIds': [pos.id], 'layoutVersions': {str(p.id): p.updated_at.isoformat() for p in visit.positions}})
    upload(db, visit, user, pos.id, state['revision'], expected=pos.updated_at)
    result = confirm(db, visit, user, state['revision'])
    current = next(p for p in result.positions if p.id == pos.id)
    assert current.direction == 'NA' and current.tmax_c - current.tref_c == 8
    assert sum(bool(i.file_path) for i in current.images) == 1
    assert current.position_code.endswith('-NA')
    assert next(i for i in current.images if i.file_path).image_code.endswith('-10003')
    assert result.rollup.possible_positions == 1


def test_not_applicable_cannot_be_used_for_tension(db):
    with pytest.raises(ValueError):
        PositionCreate(ohl='OHL1', phase='R', string='S1', direction='NA', mount_type='Tension')
    visit, user = make_visit(db)
    with pytest.raises(HTTPException):
        update_position(visit.positions[0].id, PositionUpdate(direction='NA', mount_type='Tension'), db, user)


def test_historical_image_numbers_remain_frozen():
    assert image_sequence_number('OHL1', 'R', 'S1', 'Ashoor', 'TH Full') == 1
    assert image_sequence_number('OHL2', 'B', 'S2', 'Thumrait', 'RGB Close') == 240
    numbers = [image_sequence_number(ohl, phase, string, 'NA', kind) for ohl in ['OHL1','OHL2']
        for phase in ['R','Y','B'] for string in ['S1','S2'] for kind in ['TH Full','TH Close','RGB Full','RGB Close']]
    assert len(set(numbers)) == 48 and min(numbers) > 240


@pytest.mark.parametrize('count,strings,total', [('Single',['S1'],12),('Double',['S1','S2'],24)])
def test_full_tension_positions_commit_and_pdf_includes_both_directions(db, tmp_path, count, strings, total):
    visit, user = make_visit(db)
    additions = [dict(id=-(i+1), ohl=ohl, phase=phase, string=string, direction=direction,
        mount_type='Tension', string_count=count, tmax_c=40+i, tref_c=30, screening_result='Normal', hotspot='No')
        for i, (ohl, phase, string, direction) in enumerate((o,p,s,d) for o in ['OHL1','OHL2']
            for p in ['R','Y','B'] for s in strings for d in ['Ashoor','Saada'])]
    state = save(db, visit, user, {'additions': additions, 'layoutIds': [p['id'] for p in additions],
        'layoutVersions': {str(p.id): p.updated_at.isoformat() for p in visit.positions}})
    result = confirm(db, visit, user, state['revision'])
    assert result.rollup.possible_positions == result.rollup.screened == total
    db.refresh(visit)
    extra = overflow_positions(visit)
    assert len(extra) == total // 2
    template = tmp_path / 'template.pdf'; template.write_bytes(build_starter_pdf_form())
    report = PdfReader(io.BytesIO(render_visit_report_pdf_form(visit, template)))
    original = PdfReader(template)
    assert len(report.pages) > len(original.pages)
    fields = report.get_fields()
    values = build_field_values(visit)
    for name, value in values.items():
        if name in fields:
            assert str(fields[name].get('/V', '')) == value
    appendix_text = '\n'.join(page.extract_text() for page in report.pages[len(original.pages):])
    for pos in extra:
        assert pos.position_code in appendix_text
    active = next(p for p in visit.positions if p.in_scope)
    assert active.direction in _measurement_context(1, visit, active)['remarks']
