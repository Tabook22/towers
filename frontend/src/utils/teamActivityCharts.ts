import type { ActivityTeam, ActivityTower, CountKey, Counts } from '../api/teamActivityTypes';

export function teamFieldStats(team: ActivityTeam) {
  const visited = new Set<number>(), finished = new Set<number>();
  const visitDates = new Set<string>(), recordingDates = new Set<string>(), missionDates = new Set<string>();
  const dailyVisits = new Map<string, Set<number>>();
  for (const day of team.days) {
    if (day.has_mission) missionDates.add(day.date);
    for (const tower of day.towers) {
      if (tower.recorded) recordingDates.add(day.date);
      if (tower.finished) finished.add(tower.id);
      if (tower.visited) {
        visitDates.add(day.date); visited.add(tower.id);
        if (!dailyVisits.has(day.date)) dailyVisits.set(day.date, new Set());
        dailyVisits.get(day.date)!.add(tower.id);
      }
    }
  }
  const finishedVisits = [...visited].filter(id => finished.has(id)).length;
  const visitTotal = [...dailyVisits.values()].reduce((total, ids) => total + ids.size, 0);
  return { visitDays: visitDates.size, recordingDays: recordingDates.size, missionDays: missionDates.size,
    visited: visited.size, finishedVisits, unfinishedVisits: visited.size - finishedVisits,
    completion: visited.size ? Math.round(finishedVisits / visited.size * 100) : null,
    visitTotal, visitsPerDay: visitDates.size ? visitTotal / visitDates.size : 0 };
}

export function activityTrend(teams: ActivityTeam[], start: string, end: string) {
  const byDate = new Map<string, Counts>();
  for (const team of teams) for (const day of team.days) {
    const counts = byDate.get(day.date) || { planned: 0, visited: 0, recorded: 0, finished: 0, reported: 0 };
    for (const key of Object.keys(counts) as CountKey[]) counts[key] += day.counts[key];
    byDate.set(day.date, counts);
  }
  const rows: { date: string; counts: Counts }[] = [];
  const from = Date.parse(`${start}T00:00:00Z`), to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 366 * 86400000) return rows;
  for (let tick = from; tick <= to; tick += 86400000) {
    const date = new Date(tick).toISOString().slice(0, 10);
    rows.push({ date, counts: byDate.get(date) || { planned: 0, visited: 0, recorded: 0, finished: 0, reported: 0 } });
  }
  return rows;
}

/** Merge repeated visits for chart drill-downs, preserving all evidence and report links. */
export function categoryTowers(team: ActivityTeam, key: CountKey): ActivityTower[] {
  if (key === 'reported') return team.report_towers;
  const result = new Map<number, ActivityTower>();
  for (const day of team.days) for (const tower of day.towers) {
    const previous = result.get(tower.id);
    result.set(tower.id, { ...tower,
      planned: Boolean(previous?.planned || tower.planned), visited: Boolean(previous?.visited || tower.visited),
      recorded: Boolean(previous?.recorded || tower.recorded), finished: Boolean(previous?.finished || tower.finished),
      reported: Boolean(previous?.reported || tower.reported),
      visit_ids: [...new Set([...(previous?.visit_ids || []), ...(tower.visit_ids || [])])],
      reports: [...new Map([...(previous?.reports || []), ...tower.reports].map(report => [report.id, report])).values()],
    });
  }
  return [...result.values()].filter(tower => tower[key]).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
