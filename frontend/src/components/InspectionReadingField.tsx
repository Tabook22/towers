import { useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { TextField } from '@mui/material';
import { tr } from '../i18n';
import { parseInspectionReading } from '../utils/inspectionReading';

export function InspectionReadingField({ label, value, onChange, onInvalid, inputRef, disabled = false }: {
  label: string; value: number | null; onChange: (value: number | null) => void;
  onInvalid: (invalid: boolean) => void; inputRef?: Ref<HTMLInputElement>; disabled?: boolean;
}) {
  const [raw, setRaw] = useState(String(value ?? ''));
  const notify = useRef(onInvalid);
  useEffect(() => { notify.current = onInvalid; });
  useEffect(() => {
    setRaw(current => {
      const parsed = parseInspectionReading(current);
      return parsed.valid && parsed.value === value ? current : String(value ?? '');
    });
    notify.current(false);
  }, [value]);
  const parsed = parseInspectionReading(raw);
  return <TextField size="small" label={label} fullWidth inputRef={inputRef} disabled={disabled} autoComplete="off"
    value={raw} error={!parsed.valid} helperText={!parsed.valid ? tr('Enter a valid temperature, or leave it blank.') : undefined}
    slotProps={{ htmlInput: { inputMode: 'decimal' } }} onChange={event => {
      const text = event.target.value;
      const next = parseInspectionReading(text);
      setRaw(text); onInvalid(!next.valid);
      if (next.valid) onChange(next.value);
    }} />;
}
