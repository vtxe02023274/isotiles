import { cellToPixel, drawOrder, type Point } from './iso.js';
import type { TileMap } from './map.js';
import { tileRect, type Tileset } from './tileset.js';

export interface View {
  /** Map pixel shown at the canvas origin. */
  x: number;
  y: number;
  zoom: number;
}

export interface Overlay {
  hover?: Point;
  /** Cells between two corners being dragged with the rectangle tool. */
  rect?: { a: Point; b: Point };
  /** Tile to preview under the cursor, 0 for none. */
  preview?: number;
  previewLayer?: number;
  grid: boolean;
}

export function screenToMap(view: View, sx: number, sy: number): Point {
  return { x: view.x + sx / view.zoom, y: view.y + sy / view.zoom };
}

export function render(
  ctx: CanvasRenderingContext2D,
  map: TileMap,
  tileset: Tileset,
  view: View,
  overlay: Overlay,
): void {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(view.zoom, 0, 0, view.zoom, -view.x * view.zoom, -view.y * view.zoom);
  ctx.imageSmoothingEnabled = view.zoom < 1;

  const hw = map.tileWidth / 2;
  const hh = map.tileHeight / 2;

  const diamond = (top: Point) => {
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x + hw, top.y + hh);
    ctx.lineTo(top.x, top.y + 2 * hh);
    ctx.lineTo(top.x - hw, top.y + hh);
    ctx.closePath();
  };

  // Drawn over the first layer so it shows on top of the ground but under objects.
  const drawGrid = () => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1 / view.zoom;
    ctx.beginPath();
    if (map.stagger) {
      // Staggered rows have no straight lines through the map.
      for (const { x, y } of drawOrder(map)) diamond(cellToPixel(map, x, y));
    } else {
      for (let i = 0; i <= map.height; i++) {
        const a = cellToPixel(map, 0, i);
        const b = cellToPixel(map, map.width, i);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      for (let i = 0; i <= map.width; i++) {
        const a = cellToPixel(map, i, 0);
        const b = cellToPixel(map, i, map.height);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();
  };

  const drawTile = (gid: number, cx: number, cy: number) => {
    const r = tileRect(tileset, gid - 1);
    const top = cellToPixel(map, cx, cy);
    // Bottom left of the image on the left and bottom vertices of the cell, as Tiled does.
    const ox = tileset.offsetX ?? 0;
    const oy = tileset.offsetY ?? 0;
    ctx.drawImage(
      tileset.source,
      r.x,
      r.y,
      r.w,
      r.h,
      top.x - hw + ox,
      top.y + 2 * hh - r.h + oy,
      r.w,
      r.h,
    );
  };

  map.layers.forEach((layer, li) => {
    if (li === 1 && overlay.grid) drawGrid();
    if (!layer.visible) return;
    for (const { x, y } of drawOrder(map)) {
      const gid = layer.data[y * map.width + x]!;
      const previewHere =
        overlay.preview &&
        overlay.previewLayer === li &&
        overlay.hover?.x === x &&
        overlay.hover?.y === y;
      if (previewHere) {
        ctx.globalAlpha = 0.6;
        drawTile(overlay.preview!, x, y);
        ctx.globalAlpha = 1;
      } else if (gid) {
        drawTile(gid, x, y);
      }
    }
  });

  if (map.layers.length < 2 && overlay.grid) drawGrid();

  if (overlay.rect) {
    const { a, b } = overlay.rect;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x) + 1;
    const y1 = Math.max(a.y, b.y) + 1;
    ctx.fillStyle = 'rgba(255, 224, 138, 0.15)';
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 2 / view.zoom;
    ctx.beginPath();
    if (map.stagger) {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) diamond(cellToPixel(map, x, y));
    } else {
      const corners = [
        cellToPixel(map, x0, y0),
        cellToPixel(map, x1, y0),
        cellToPixel(map, x1, y1),
        cellToPixel(map, x0, y1),
      ];
      corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  if (overlay.hover) {
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 2 / view.zoom;
    ctx.beginPath();
    diamond(cellToPixel(map, overlay.hover.x, overlay.hover.y));
    ctx.stroke();
  }
}
