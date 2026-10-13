// The 13x13 hand grid frame shared by every range grid: thirteen rows of thirteen cells for
// screen readers, one Tab stop, and the arrow keys (plus Home and End) to move between cells.

import type { HTMLAttributes, ReactNode } from 'react';
import { GRID_SIZE, useGridNav, type GridCellProps } from './a11y';

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: string;
  /** How many cells (169 for a full grid). */
  count: number;
  /** Renders cell `i` as a role="gridcell" element, spreading `nav` onto it. */
  cell: (i: number, nav: GridCellProps) => ReactNode;
}

export function HandGrid({ label, count, cell, className = '', ...rest }: Props) {
  const { onKeyDown, cellProps } = useGridNav();
  const rows: ReactNode[] = [];
  for (let r = 0; r * GRID_SIZE < count; r++) {
    const cells: ReactNode[] = [];
    for (let i = r * GRID_SIZE; i < Math.min(count, (r + 1) * GRID_SIZE); i++) cells.push(cell(i, cellProps(i)));
    rows.push(<div key={r} role="row" className="grid-row">{cells}</div>);
  }
  return (
    <div className={`range-grid ${className}`.trim()} role="grid" aria-label={label} onKeyDown={onKeyDown} {...rest}>
      {rows}
    </div>
  );
}
