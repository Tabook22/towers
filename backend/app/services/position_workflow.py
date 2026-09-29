"""Shared distinction between a prepared layout and recorded field observations."""
OBSERVATION_FIELDS = {
    'screening_result', 'hotspot', 'tmax_c', 'tref_c', 'severity', 'confidence',
    'inspector_notes', 'pollution_condition', 'thermal_indication', 'visual_indications',
}


def has_observations(pos):
    return (pos.screening_result not in (None, 'Not inspected')
            or any(getattr(pos, field, None) not in (None, '') for field in OBSERVATION_FIELDS - {'screening_result'})
            or bool(pos.voice_note_path)
            or any(image.file_path for image in pos.images))


def reportable_position(pos):
    if getattr(pos, 'in_scope', True) is False:
        return False
    if getattr(pos, 'prepared_only', False):
        return has_observations(pos)
    # Preserve the legacy inclusion rule for existing inspections.
    return bool(pos.direction) or any(image.file_path for image in pos.images)
