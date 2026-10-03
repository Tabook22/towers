"""Customer-safe, immutable inspection data at report issue time.

Use explicit allowlists: paths, account assignments and unrelated visit photos must not
leak through an ORM-to-dict conversion. A snapshot is provenance, not another editable visit.
"""
import datetime as dt
from app.services.position_workflow import reportable_position
from app.services.report_images import selected_images

VISIT_FIELDS = (
    'inspection_date', 'inspector_name', 'latitude', 'longitude', 'weather_wind',
    'electrical_load', 'camera_drone', 'thermal_mode', 'emissivity', 'reflected_temp',
    'permit_job_no', 'camera_serial_no', 'calibration_cert_no', 'calibration_due_date',
    'distance_to_target_m', 'ambient_temp_c', 'humidity_pct', 'status', 'start_time', 'end_time',
)
POSITION_FIELDS = (
    'position_code', 'ohl', 'phase', 'string', 'direction', 'view_side', 'tower_proximity',
    'installed', 'screening_result', 'hotspot', 'tmax_c', 'tref_c', 'delta_t', 'severity',
    'confidence', 'inspector_notes', 'manufacturer', 'year_installed', 'insulator_type',
    'mount_type', 'gs_side', 'string_count', 'pollution_condition', 'thermal_indication',
    'visual_indications', 'voice_note_transcript', 'voice_note_duration_seconds',
)
ASSESSMENT_FIELDS = (
    'overall_condition', 'probable_cause', 'corrective_action', 'additional_comments',
    'prepared_by', 'reviewed_by', 'approved_by', 'approval_date',
)


def _values(record, fields):
    def scalar(value):
        return value.isoformat() if isinstance(value, (dt.date, dt.time)) else value
    return {field: scalar(getattr(record, field, None)) for field in fields}


def capture_inspection_snapshot(team, visits, assessment):
    rows = []
    for visit in sorted(visits, key=lambda v: (str(v.inspection_date or ''), v.id or 0)):
        positions = []
        for pos in sorted(visit.positions, key=lambda p: p.id or 0):
            if not reportable_position(pos):
                continue
            item = _values(pos, POSITION_FIELDS)
            item['id'] = pos.id
            item['evidence'] = [{
                'image_id': image.id, 'image_type': image.image_type,
                'checksum': image.checksum,
                'capture_date': image.capture_date.isoformat() if image.capture_date else None,
                'capture_time': image.capture_time.isoformat() if image.capture_time else None,
                'evidence_status': image.evidence_status,
            } for image in selected_images(pos)]
            positions.append(item)
        rows.append({
            'id': visit.id, 'tower': visit.tower.tower_id, 'area': visit.tower.area,
            'line_sector': visit.tower.line_sector,
            **_values(visit, VISIT_FIELDS), 'positions': positions,
        })
    return {'version': 1, 'team_name': team.name, 'assessment': _values(assessment, ASSESSMENT_FIELDS), 'visits': rows}


def snapshot_image_status(snapshot, image):
    if not snapshot:
        return 'unverified'
    for visit in snapshot.get('visits', []):
        for position in visit['positions']:
            for evidence in position['evidence']:
                if evidence['image_id'] == image.id:
                    checksum = evidence.get('checksum')
                    return ('unchanged' if checksum == image.checksum else 'changed') if checksum else 'unverified'
    return 'unverified'
