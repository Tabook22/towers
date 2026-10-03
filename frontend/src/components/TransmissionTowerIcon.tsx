import { createSvgIcon } from '@mui/material/utils';

/** Lattice transmission pylon: crossarms, insulators and braced steel legs. */
export default createSvgIcon(
  <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 22h10M8 22l2-16 2-4 2 4 2 16M10 6h4M10 7l5 11M14 7 9 18M9 18l7 4M15 18l-7 4" />
    <path d="M6 8h12l-4-2M6 8l4-2M3 13h18l-6-3M3 13l6-3M5 18h14l-4-3M5 18l4-3" />
    <path d="M6 8v2m12-2v2M3 13v2m18-2v2M5 18v2m14-2v2" />
  </g>,
  'TransmissionTower',
);
