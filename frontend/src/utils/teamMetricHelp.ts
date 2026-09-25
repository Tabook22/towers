interface Explanation {
  title: string; meaning: string; input: string; calculation: string; importance: string; example: string;
}

export const teamMetricHelp = {
  planned: {
    title: 'Mission towers', meaning: 'Towers selected in a saved daily mission plan.',
    input: 'The tower lists in the team’s daily mission plans, using each plan’s field date.',
    calculation: 'Count each selected tower once per team in the chosen period. In a daily table row, count it once on that date.',
    importance: 'Shows the planned workload. Visits can exceed this number when extra towers are inspected or a mission plan was not saved.',
    example: 'The same tower planned on Monday and Tuesday counts as 1 mission tower in the period, but 1 in each daily row. Ending a mission does not automatically finish every tower.',
  },
  visited: {
    title: 'Visited', meaning: 'Towers with evidence that field activity took place.',
    input: 'On-site or done check-ins, saved arrival times, inspections marked in progress or completed/closed, uploaded inspection photos, or screening results other than “Not inspected”.',
    calculation: 'A tower qualifies if any of these signals exists. Count it once per team for the period, or once per date in the daily table.',
    importance: 'Separates actual field activity from planning. An empty checklist or a tower on a mission plan alone does not prove a visit.',
    example: 'Visit tower A on two dates: the period total is 1 visited tower; the daily table shows 1 on each date.',
  },
  recorded: {
    title: 'Recorded', meaning: 'Towers with a saved inspection record in the system.',
    input: 'Saved inspection records and their entered inspection dates, including planned or draft records.',
    calculation: 'Count each tower with a record once per team in the period. Multiple records for that tower on one date still count once in that daily row.',
    importance: 'Shows whether inspection paperwork has been started. It does not guarantee complete images, a finished inspection, or a final report.',
    example: 'A draft record with no inspection evidence counts as recorded, but may not count as visited or finished.',
  },
  finished: {
    title: 'Finished', meaning: 'Towers marked as having completed field work.',
    input: 'A tower check-in marked done, an inspection’s mission status marked completed, or an inspection record marked closed.',
    calculation: 'Count each qualifying tower once per team in the period, or once on each qualifying date in the table.',
    importance: 'Tracks completion in the field. It does not confirm that all paperwork is complete or that a customer report has been saved or approved.',
    example: 'A team can have 17 finished towers and 0 towers in reports while it is still preparing the customer documents.',
  },
  reported: {
    title: 'In reports', meaning: 'Distinct towers identified in saved official reports for the selected period.',
    input: 'The tower scope saved with each report, or traceable tower/inspection links in older reports. Dates refer to the inspection period, not when the document was created.',
    calculation: 'Count a tower once per team even if it appears in several reports. A report with no traceable tower list adds no towers. Older reports without an exact inspection day may count in the period total but not in daily rows.',
    importance: 'Shows how much work has reached a saved report. This is report coverage, not the number of documents or proof of customer approval.',
    example: 'One report covering 5 towers produces 5 towers in reports. Two reports about the same tower produce 1 tower in reports.',
  },
  visitDays: {
    title: 'Visit days', meaning: 'Dates on which this team visited at least one tower.',
    input: 'The saved field dates of qualifying check-ins and the inspection dates of qualifying inspection records.',
    calculation: 'Count distinct dates with one or more visited towers inside the selected period. Several towers visited on the same date still make one visit day.',
    importance: 'Shows the number of days with recorded field activity. A saved mission plan alone does not create a visit day.',
    example: 'Visit 8 towers on Monday and 3 on Tuesday: 2 visit days. A day with no recorded activity does not prove the team was absent.',
  },
  recordingDays: {
    title: 'Recording days', meaning: 'Inspection dates with at least one saved inspection record.',
    input: 'The inspection date entered on each saved record, including drafts.',
    calculation: 'Count distinct inspection dates for records in the selected period. This is not the number of days someone logged in or typed data.',
    importance: 'Shows which field dates have inspection records. Compare it with visit days to identify dates that may need a records check.',
    example: 'On Friday, enter records for inspections dated Monday and Tuesday: this counts as 2 recording days, not 1 Friday data-entry day.',
  },
  missionDays: {
    title: 'Mission days', meaning: 'Dates with a saved daily mission plan for the team.',
    input: 'Daily mission plans and their saved field dates.',
    calculation: 'Count each date with a plan once, even if the mission has no recorded visits yet. This matches the daily-missions count in the team heading.',
    importance: 'Shows how consistently the team’s work is planned. Planning a mission does not confirm attendance or completion.',
    example: 'Plans saved for Monday, Tuesday and Wednesday produce 3 mission days, even if field activity is only recorded on 2 of them.',
  },
  average: {
    title: 'Towers / visit-day', meaning: 'Average number of towers visited on a day with field activity.',
    input: 'The daily visited-tower counts and the number of visit days for this team.',
    calculation: 'Add the daily visited counts, then divide by visit days. A repeat visit on another date counts again in this workload average. The result is shown to one decimal place; with no visit days it is 0.0.',
    importance: 'Helps compare daily workload. It is not an inspection-quality score, and does not account for travel, access problems or tower difficulty.',
    example: 'Visit towers A and B on Monday, then A again on Tuesday: 3 daily tower visits ÷ 2 days = 1.5 towers per visit-day.',
  },
  completion: {
    title: 'Visited towers · completion', meaning: 'The share of visited towers that have been marked finished.',
    input: 'Distinct visited towers and their finished status for this team within the selected period.',
    calculation: 'Finished visited towers ÷ all visited towers × 100, rounded to a whole percentage. Green means finished; amber means visited but not marked finished. With no visits, the chart shows “no visits yet”.',
    importance: 'Shows remaining field work among towers already visited. Planned but unvisited towers are outside this pie. Report readiness and approval are separate.',
    example: '17 finished out of 18 visited: 17 ÷ 18 × 100 = 94%. The remaining slice is 1 visited tower not yet marked finished.',
  },
  progress: {
    title: 'Tower progress', meaning: 'A comparison of planned, visited, recorded, finished and reported towers.',
    input: 'Saved mission plans, field check-ins, inspection records and saved report scopes for the selected team and dates.',
    calculation: 'Each bar uses that category’s unique tower count. Its length is relative to the largest value in this team’s chart; the number at the end is the actual count, not a percentage.',
    importance: 'Helps spot differences between field work and documentation. The categories overlap and should not be added together. A tower can belong to several categories.',
    example: '16 mission towers and 18 visited towers can be valid if 2 extra towers were inspected. Select a bar to see the towers behind its count.',
  },
  daily: {
    title: 'Daily tower activity', meaning: 'Visited, recorded and finished tower counts plotted by date.',
    input: 'The same dated tower activity shown in the daily tables, for the selected teams and period.',
    calculation: 'For each date, count a tower once per team in each category and add the selected teams’ counts. The horizontal axis is the date; the vertical axis is towers. Repeat visits count on each visit date.',
    importance: 'Reveals busy dates and gaps between visiting, recording and finishing. Zero means no qualifying activity is saved for that date, not proof of a missed assignment.',
    example: 'Move across the graph or use the date slider for exact numbers. The legend buttons hide/show lines without changing any data. Daily sums can exceed the unique period totals.',
  },
  fieldDays: {
    title: 'Days in the field', meaning: 'A comparison of each team’s number of visit days.',
    input: 'Each team’s distinct dates with qualifying visits in the selected period.',
    calculation: 'Count dates with at least one visited tower for each team. Bar lengths are relative to the highest displayed day count, not the length of the month.',
    importance: 'Shows how many dates have field activity recorded for each team. It is not hours worked or a formal attendance record.',
    example: 'A team visiting 10 towers on one date has 1 visit day. Select its bar to focus the whole page on that team.',
  },
  teamDays: {
    title: 'Team visit-days', meaning: 'The combined number of visit days across the selected teams.',
    input: 'The visit-day count of each team currently included by the Team filter.',
    calculation: 'Add the teams’ visit-day counts. The same calendar date counts separately for each team that visited a tower.',
    importance: 'Summarizes recorded deployment across crews. It is not the number of unique calendar dates or the number of individual workers.',
    example: 'Team A visits on 2 days and Team B on 3 days: 5 team visit-days, even if some of those dates overlap.',
  },
  dayMission: {
    title: 'Day / mission', meaning: 'One date of this team’s planned or recorded tower activity.',
    input: 'Mission plans and check-ins use their saved field date. Inspection records use their entered inspection date. Reports use their traced inspection dates where available.',
    calculation: 'Group activity by team and date. Each column counts a tower once on that date. The same tower may appear on several dates, so adding rows can exceed the period total.',
    importance: 'Lets you trace work to a specific day. “No saved mission plan” means there is no plan for that date; it does not mean no visit happened. “Ended” describes the mission plan, not every tower’s completion.',
    example: 'Tower A visited Monday and Tuesday appears in both daily rows but only once in the team’s period total. Select a number to see that day’s matching towers.',
  },
  reportCount: {
    title: 'Towers and saved reports', meaning: 'Two different counts: towers covered, and report documents saved.',
    input: 'Reports assigned to the team whose inspection periods overlap the selected dates, plus the tower scope saved or traced for those reports.',
    calculation: 'Count report records for documents, and distinct qualifying towers for tower coverage. Several documents can cover one tower, and one document can cover several towers. Older documents with unknown scope can add to report count without adding traceable towers.',
    importance: 'Distinguishes the customer deliverables from the amount of field work they describe. A saved report is not automatically approved.',
    example: '“5 towers in 2 reports” means 2 saved documents collectively identify 5 distinct towers. Select the button to inspect the report links.',
  },
  filters: {
    title: 'Dates, teams and daily order', meaning: 'Controls which activity is included and how daily rows are displayed.',
    input: 'The From date, To date, Team and Daily order controls above the dashboard.',
    calculation: 'Both date boundaries are included, with a maximum span of 367 calendar dates. Only teams you can access are included. Daily order changes row order only; it does not change counts or the chronological graph.',
    importance: 'Makes comparisons consistent. These are field/inspection dates, not login dates or report-creation dates. Top totals add each team’s unique tower counts, so the same tower handled by two teams can count twice.',
    example: 'Select one team and 1–7 September to inspect that crew’s week. “This month” resets the dates using the current calendar date in Oman; it keeps the selected team.',
  },
} satisfies Record<string, Explanation>;

export type TeamMetricTopic = keyof typeof teamMetricHelp;
