/**
 * Isometric projection in the same convention Tiled uses: cell (0, 0) is the
 * top diamond, x grows down to the right and y grows down to the left. Map
 * pixel coordinates put the top vertex of cell (0, 0) at
 * (mapHeight * tileWidth / 2, 0).
 *
 * Staggered maps (Tiled's "staggered" orientation) lay the diamonds out in
 * rows or columns instead, every other one shifted by half a tile.
 */
export interface Grid {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  stagger?: Stagger;
}

export interface Stagger {
  /** "y" shifts every other row right, "x" every other column down. */
  axis: 'x' | 'y';
  /** Which rows or columns are shifted. */
  index: 'odd' | 'even';
}

export interface Point {
  x: number;
  y: number;
}

/** Whether row (axis y) or column (axis x) `i` is shifted. */
function shifted(stagger: Stagger, i: number): boolean {
  return (i % 2 !== 0) === (stagger.index === 'odd');
}

/** Top vertex of a cell's diamond, in map pixels. */
export function cellToPixel(grid: Grid, cx: number, cy: number): Point {
  const hw = grid.tileWidth / 2;
  const hh = grid.tileHeight / 2;
  const s = grid.stagger;
  if (s?.axis === 'y') {
    return { x: cx * grid.tileWidth + (shifted(s, cy) ? hw : 0) + hw, y: cy * hh };
  }
  if (s?.axis === 'x') {
    return { x: cx * hw + hw, y: cy * grid.tileHeight + (shifted(s, cx) ? hh : 0) };
  }
  return { x: grid.height * hw + (cx - cy) * hw, y: (cx + cy) * hh };
}

/**
 * The cell whose diamond contains the point. Exact on the diamond edges, not
 * an approximation by the bounding box. May return cells outside the map.
 */
export function pixelToCell(grid: Grid, px: number, py: number): Point {
  const hw = grid.tileWidth / 2;
  const hh = grid.tileHeight / 2;
  if (!grid.stagger) {
    const fx = (px - grid.height * hw) / hw;
    const fy = py / hh;
    return { x: Math.floor((fy + fx) / 2), y: Math.floor((fy - fx) / 2) };
  }
  // The point is in one of the diamonds around the cell at the same
  // bounding box position; take the one it is deepest inside of.
  const gx = grid.stagger.axis === 'y' ? Math.floor(px / grid.tileWidth) : Math.floor(px / hw);
  const gy = grid.stagger.axis === 'y' ? Math.floor(py / hh) : Math.floor(py / grid.tileHeight);
  let best = { x: gx, y: gy };
  let bestDistance = Infinity;
  for (let y = gy - 1; y <= gy + 1; y++) {
    for (let x = gx - 1; x <= gx + 1; x++) {
      const top = cellToPixel(grid, x, y);
      const d = Math.abs(px - top.x) / hw + Math.abs(py - top.y - hh) / hh;
      if (d < bestDistance) {
        best = { x, y };
        bestDistance = d;
      }
    }
  }
  return best;
}

export function inBounds(grid: Grid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < grid.width && cy < grid.height;
}

/** Size of the whole map in pixels, not counting tiles taller than the grid. */
export function mapPixelSize(grid: Grid): Point {
  const hw = grid.tileWidth / 2;
  const hh = grid.tileHeight / 2;
  const s = grid.stagger;
  if (s?.axis === 'y') {
    const anyShifted = grid.height > 1 || shifted(s, 0);
    return { x: grid.width * grid.tileWidth + (anyShifted ? hw : 0), y: (grid.height + 1) * hh };
  }
  if (s?.axis === 'x') {
    const anyShifted = grid.width > 1 || shifted(s, 0);
    return { x: (grid.width + 1) * hw, y: grid.height * grid.tileHeight + (anyShifted ? hh : 0) };
  }
  return { x: (grid.width + grid.height) * hw, y: (grid.width + grid.height) * hh };
}

/**
 * Cells in back to front order, so tall tiles overlap the ones behind them.
 * Isometric maps go diagonal by diagonal (cx + cy constant). Staggered maps go
 * row by row, and with columns staggered the raised columns of a row come
 * before the lowered ones.
 */
export function* drawOrder(grid: Grid): Generator<Point> {
  const s = grid.stagger;
  if (s?.axis === 'y') {
    for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) yield { x, y };
    return;
  }
  if (s?.axis === 'x') {
    for (let y = 0; y < grid.height; y++) {
      for (const lowered of [false, true]) {
        for (let x = 0; x < grid.width; x++) if (shifted(s, x) === lowered) yield { x, y };
      }
    }
    return;
  }
  for (let d = 0; d < grid.width + grid.height - 1; d++) {
    const start = Math.max(0, d - grid.height + 1);
    const end = Math.min(d, grid.width - 1);
    for (let cx = start; cx <= end; cx++) yield { x: cx, y: d - cx };
  }
}

/** The four cells sharing an edge with (cx, cy). May be outside the map. */
export function neighbours(grid: Grid, cx: number, cy: number): Point[] {
  const s = grid.stagger;
  if (s?.axis === 'y') {
    const dx = shifted(s, cy) ? 0 : -1;
    return [
      { x: cx + dx, y: cy - 1 },
      { x: cx + dx + 1, y: cy - 1 },
      { x: cx + dx, y: cy + 1 },
      { x: cx + dx + 1, y: cy + 1 },
    ];
  }
  if (s?.axis === 'x') {
    const dy = shifted(s, cx) ? 0 : -1;
    return [
      { x: cx - 1, y: cy + dy },
      { x: cx + 1, y: cy + dy },
      { x: cx - 1, y: cy + dy + 1 },
      { x: cx + 1, y: cy + dy + 1 },
    ];
  }
  return [
    { x: cx - 1, y: cy },
    { x: cx + 1, y: cy },
    { x: cx, y: cy - 1 },
    { x: cx, y: cy + 1 },
  ];
}
