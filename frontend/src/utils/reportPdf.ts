import type { LineInspectionReportOut } from '../api/types';

/** Match the completed job's archived filename; never assume the newest report is ours. */
export function generatedWordReport(rows: LineInspectionReportOut[], filename?: string): LineInspectionReportOut | undefined {
  if (!filename || !/\.docx$/i.test(filename)) return undefined;
  const number = filename.replace(/\.docx$/i, '');
  const matches = rows.filter(row => row.has_file && (row.report_number === number || row.report_number.replaceAll('/', '-') === number));
  return matches.length === 1 ? matches[0] : undefined;
}
