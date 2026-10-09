"""Per-job progress measured from completed report work, never from a timer."""
from contextvars import ContextVar
from contextlib import contextmanager
import time

current = ContextVar('report_progress', default=None)


class Progress:
    def __init__(self, publish):
        self.publish = publish
        self.last = 0
        self.data = dict(stage='Loading inspections', completed=0, total=0, percent=0,
                         findings_done=0, findings_total=0, photos_done=0, photos_total=0,
                         sections_done=0, sections_total=0)

    def plan(self, groups):
        from app.services.team_activity_report import _position_has_activity
        from app.services.oetc_report import used_image_ids
        self.data.update(findings_total=sum(_position_has_activity(p) for visits in groups for v in visits for p in v.positions),
                         photos_total=sum(len(used_image_ids(visits)) for visits in groups), sections_total=len(groups))
        self.data['total'] = self.data['findings_total'] + self.data['photos_total'] + len(groups) * 4 + 1
        self.emit(force=True)

    def stage(self, stage):
        self.data['stage'] = stage
        self.emit(force=True)

    def advance(self, kind=None):
        self.data['completed'] += 1
        if kind:
            self.data[kind + '_done'] += 1
        self.data['percent'] = min(99, int(100 * self.data['completed'] / max(1, self.data['total'])))
        self.emit()

    def emit(self, force=False):
        if force or time.monotonic() - self.last >= 0.5:
            self.publish(**self.data)
            self.last = time.monotonic()


@contextmanager
def tracking(progress):
    token = current.set(progress)
    try:
        yield
    finally:
        current.reset(token)


def plan(groups):
    if progress := current.get():
        progress.plan(groups)


def stage(name):
    if progress := current.get():
        progress.stage(name)


def advance(kind=None):
    if progress := current.get():
        progress.advance(kind)
