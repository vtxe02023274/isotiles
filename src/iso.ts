/**
 * Isometric projection in the same convention Tiled uses: cell (0, 0) is the
 * top diamond, x grows down to the right and y grows down to the left. Map
 * pixel coordinates put the top vertex of cell (0, 0) at
 * (mapHeight * tileWidth / 2, 0).
 */
export interface Grid {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Top vertex of a cell's diamond, in map pixels. */
export function cellToPixel(grid: Grid, cx: number, cy: number): Point {
  return {
    x: grid.height * (grid.tileWidth / 2) + (cx - cy) * (grid.tileWidth / 2),
    y: (cx + cy) * (grid.tileHeight / 2),
  };
}

/**
 * The cell whose diamond contains the point. Exact on the diamond edges, not
 * an approximation by the bounding box. May return cells outside the map.
 */
export function pixelToCell(grid: Grid, px: number, py: number): Point {
  const fx = (px - grid.height * (grid.tileWidth / 2)) / (grid.tileWidth / 2);
  const fy = py / (grid.tileHeight / 2);
  return { x: Math.floor((fy + fx) / 2), y: Math.floor((fy - fx) / 2) };
}

export function inBounds(grid: Grid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < grid.width && cy < grid.height;
}

/** Size of the whole map in pixels, not counting tiles taller than the grid. */
export function mapPixelSize(grid: Grid): Point {
  return {
    x: (grid.width + grid.height) * (grid.tileWidth / 2),
    y: (grid.width + grid.height) * (grid.tileHeight / 2),
  };
}

/**
 * Cells in back to front order. Each diagonal (cx + cy constant) is drawn
 * after the ones behind it, so tall tiles overlap the right neighbours.
 */
export function* drawOrder(grid: Grid): Generator<Point> {
  for (let d = 0; d < grid.width + grid.height - 1; d++) {
    const start = Math.max(0, d - grid.height + 1);
    const end = Math.min(d, grid.width - 1);
    for (let cx = start; cx <= end; cx++) yield { x: cx, y: d - cx };
  }
}
