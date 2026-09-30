import { tr } from './index';

const enumFields = new Set(['mount_type', 'string_count', 'tower_proximity', 'screening_result', 'hotspot', 'severity', 'confidence', 'insulator_type', 'pollution_condition', 'thermal_indication', 'mission_status', 'thermal_mode']);

/** Translate known choices only. Free text, manufacturer names and position identities are data. */
export function inspectionValue(field: string, value: unknown): string {
  if (value == null || value === '') return tr('Not set');
  if (typeof value === 'boolean') return tr(value ? 'Yes' : 'No');
  if (field === 'visual_indications') return String(value).split(',').map(item => tr(item.trim())).join('، ');
  if (enumFields.has(field)) return tr(value === 'Single' ? '1 string' : value === 'Double' ? '2 strings' : String(value));
  return String(value);
}

export const visitFieldLabels: Record<string, string> = {
  inspection_date: 'Inspection date', inspector_name: 'Inspector', permit_job_no: 'Permit / Job No.',
  weather_wind: 'Weather / wind', electrical_load: 'Electrical load', camera_drone: 'Camera / drone',
  thermal_mode: 'Thermal mode', emissivity: 'Emissivity', reflected_temp: 'Reflected temp (°C)',
  camera_serial_no: 'Camera serial no.', calibration_cert_no: 'Calibration certificate no.',
  calibration_due_date: 'Calibration due date', distance_to_target_m: 'Distance to target (m)',
  ambient_temp_c: 'Ambient temp (°C)', humidity_pct: 'Humidity (%)',
  start_time: 'Start time', end_time: 'End time', mission_status: 'Mission status',
  latitude: 'Latitude', longitude: 'Longitude',
};

/** These are generated checks, never inspector notes. Keep interpolation separate from translation. */
export function inspectionCheck(message: string): string {
  const match = /^(\d+) (.+)$/.exec(message);
  return match ? tr(`{0} ${match[2]}`, [match[1]]) : tr(message);
}
