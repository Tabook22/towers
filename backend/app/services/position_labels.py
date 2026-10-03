"""Report labels separate tower side from line direction; legacy identifiers stay unchanged."""
def view_label(position):
    side = getattr(position, 'view_side', None)
    return side + ' view' if side in ('Front', 'Back') else 'View not recorded'


def inspection_direction_label(position):
    return direction_label(position) + ' / ' + view_label(position)


def direction_label(position):
    return 'N/A' if position.mount_type == 'Suspension' else position.direction or '-'


def position_label(position):
    parts = [view_label(position), position.ohl, position.phase, position.mount_type or '-', position.string]
    if position.mount_type != 'Suspension':
        parts.append(position.direction or '-')
    if position.string_count == 'Double':
        parts.append(position.tower_proximity or ('Outer' if position.string == 'S1' else 'Inner'))
    return ' / '.join(parts)
