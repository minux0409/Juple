import { edgeAlignedCellPadding } from '../SavedLinkGridCard';
import { GRID_CELL_PADDING_H } from '../savedLinkLayout';

describe('edgeAlignedCellPadding - Grid rows on the content edge', () => {
  it.each([2, 3, 4, 6])('%i columns: the first card starts on the edge, the last ends on it, every gap stays the same', columns => {
    const paddings = Array.from({ length: columns }, (_, column) => edgeAlignedCellPadding(column, columns));
    expect(paddings[0].paddingStart).toBe(0);
    expect(paddings[columns - 1].paddingEnd).toBe(0);
    // Every cell gives up the same total, so every card is the same width.
    const totals = paddings.map(padding => padding.paddingStart + padding.paddingEnd);
    totals.forEach(total => expect(total).toBeCloseTo(totals[0]));
    // Between two neighbours: the usual gap (each cell contributed half of it before).
    for (let column = 0; column < columns - 1; column += 1) {
      expect(paddings[column].paddingEnd + paddings[column + 1].paddingStart).toBeCloseTo(GRID_CELL_PADDING_H * 2);
    }
  });
});
