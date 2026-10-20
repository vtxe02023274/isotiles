import { describe, expect, it } from 'vitest';
import {
  cellToPixel,
  drawOrder,
  mapPixelSize,
  neighbours,
  pixelToCell,
  type Grid,
} from '../src/iso.js';
import { createMap, fillRect, floodFill, getTile, History, setTile } from '../src/map.js';
import { GENERATED_TILESET } from '../src/tileset.js';
import { fromTmj, toTmj, TmjError } from '../src/tmj.js';

const grid: Grid = { width: 10, height: 6, tileWidth: 64, tileHeight: 32 };

describe('iso', () => {
  it('puts cell (0, 0) at the top of the map like Tiled', () => {
    expect(cellToPixel(grid, 0, 0)).toEqual({ x: 6 * 32, y: 0 });
    expect(cellToPixel(grid, 1, 0)).toEqual({ x: 7 * 32, y: 16 });
    expect(cellToPixel(grid, 0, 1)).toEqual({ x: 5 * 32, y: 16 });
    expect(mapPixelSize(grid)).toEqual({ x: 16 * 32, y: 16 * 16 });
  });

  it('maps every point inside a diamond back to its cell', () => {
    for (let cy = 0; cy < grid.height; cy++) {
      for (let cx = 0; cx < grid.width; cx++) {
        const top = cellToPixel(grid, cx, cy);
        // Center and points just inside each vertex.
        for (const [dx, dy] of [
          [0, 16],
          [0, 1],
          [31, 16],
          [0, 31],
          [-31, 16],
        ] as const) {
          expect(pixelToCell(grid, top.x + dx, top.y + dy)).toEqual({ x: cx, y: cy });
        }
      }
    }
  });

  it('splits the bounding box corners between the neighbours', () => {
    const top = cellToPixel(grid, 3, 2);
    // Past the top left edge is the previous x, past the top right edge the previous y.
    expect(pixelToCell(grid, top.x - 30, top.y + 2)).toEqual({ x: 2, y: 2 });
    expect(pixelToCell(grid, top.x + 30, top.y + 2)).toEqual({ x: 3, y: 1 });
  });

  it('draws every cell once, back to front', () => {
    const order = [...drawOrder(grid)];
    expect(order).toHaveLength(grid.width * grid.height);
    expect(new Set(order.map((p) => `${p.x},${p.y}`)).size).toBe(order.length);
    for (let i = 1; i < order.length; i++) {
      expect(order[i]!.x + order[i]!.y).toBeGreaterThanOrEqual(order[i - 1]!.x + order[i - 1]!.y);
    }
  });
});

describe('staggered', () => {
  const rows: Grid = { ...grid, stagger: { axis: 'y', index: 'odd' } };
  const columns: Grid = { ...grid, stagger: { axis: 'x', index: 'even' } };

  it('shifts every other row or column like Tiled', () => {
    expect(cellToPixel(rows, 0, 0)).toEqual({ x: 32, y: 0 });
    expect(cellToPixel(rows, 0, 1)).toEqual({ x: 64, y: 16 });
    expect(cellToPixel(rows, 2, 2)).toEqual({ x: 160, y: 32 });
    expect(mapPixelSize(rows)).toEqual({ x: 10 * 64 + 32, y: 7 * 16 });

    expect(cellToPixel(columns, 0, 0)).toEqual({ x: 32, y: 16 });
    expect(cellToPixel(columns, 1, 0)).toEqual({ x: 64, y: 0 });
    expect(mapPixelSize(columns)).toEqual({ x: 11 * 32, y: 6 * 32 + 16 });
  });

  it('maps every point inside a diamond back to its cell', () => {
    for (const g of [rows, columns]) {
      for (let cy = -1; cy <= g.height; cy++) {
        for (let cx = -1; cx <= g.width; cx++) {
          const top = cellToPixel(g, cx, cy);
          for (const [dx, dy] of [
            [0, 16],
            [0, 1],
            [31, 16],
            [0, 31],
            [-31, 16],
          ] as const) {
            expect(pixelToCell(g, top.x + dx, top.y + dy)).toEqual({ x: cx, y: cy });
          }
        }
      }
    }
  });

  it('finds the four cells that share an edge', () => {
    for (const g of [rows, columns, grid]) {
      const centre = (p: { x: number; y: number }) => {
        const top = cellToPixel(g, p.x, p.y);
        return { x: top.x, y: top.y + 16 };
      };
      for (const [cx, cy] of [
        [3, 2],
        [4, 3],
      ] as const) {
        const c = centre({ x: cx, y: cy });
        const offsets = neighbours(g, cx, cy)
          .map(centre)
          .map((n) => `${n.x - c.x},${n.y - c.y}`)
          .sort();
        expect(offsets).toEqual(['-32,-16', '-32,16', '32,-16', '32,16']);
      }
    }
  });

  it('draws every cell once, back to front', () => {
    for (const g of [rows, columns]) {
      const order = [...drawOrder(g)];
      expect(new Set(order.map((p) => `${p.x},${p.y}`)).size).toBe(g.width * g.height);
      const bottoms = order.map((p) => cellToPixel(g, p.x, p.y).y);
      for (let i = 1; i < bottoms.length; i++) {
        expect(bottoms[i]).toBeGreaterThanOrEqual(bottoms[i - 1]!);
      }
    }
  });

  it('flood fills along the diamond edges', () => {
    const map = createMap(4, 4, 64, 32, { axis: 'y', index: 'odd' });
    // Column 1 is a zigzag wall, so the fill from (0, 0) stays in column 0.
    for (let y = 0; y < 4; y++) setTile(map, 0, 1, y, 2);
    const changed = floodFill(map, 0, 0, 0, 3).map((c) => c.index);
    expect(changed.sort((a, b) => a - b)).toEqual([0, 4, 8, 12]);
  });

  it('round trips through tmj', () => {
    const map = createMap(3, 5, 64, 32, { axis: 'x', index: 'even' });
    setTile(map, 0, 2, 4, 7);
    const tmj = toTmj(map, GENERATED_TILESET);
    expect(tmj).toMatchObject({ orientation: 'staggered', staggeraxis: 'x', staggerindex: 'even' });
    expect(fromTmj(JSON.parse(JSON.stringify(tmj))).map).toEqual(map);
  });
});

describe('editing', () => {
  it('fills only the connected area', () => {
    const map = createMap(5, 5);
    for (let y = 0; y < 5; y++) setTile(map, 0, 2, y, 9);
    const changes = floodFill(map, 0, 0, 0, 3);
    expect(changes).toHaveLength(10);
    expect(getTile(map, 0, 1, 4)).toBe(3);
    expect(getTile(map, 0, 2, 2)).toBe(9);
    expect(getTile(map, 0, 3, 0)).toBe(0);
    expect(floodFill(map, 0, 0, 0, 3)).toEqual([]);
  });

  it('undoes a whole stroke in one step and redoes it', () => {
    const map = createMap(4, 4);
    const history = new History(() => map);
    history.begin();
    for (let x = 0; x < 4; x++) history.record(setTile(map, 0, x, 1, 5));
    history.end();
    history.record(setTile(map, 0, 0, 0, 7));

    expect(history.undo()).toBe(true);
    expect(getTile(map, 0, 0, 0)).toBe(0);
    expect(getTile(map, 0, 3, 1)).toBe(5);
    expect(history.undo()).toBe(true);
    expect(Array.from(map.layers[0]!.data).every((v) => v === 0)).toBe(true);
    expect(history.undo()).toBe(false);

    expect(history.redo()).toBe(true);
    expect(getTile(map, 0, 2, 1)).toBe(5);
  });

  it('keeps the open stroke when begin is called again', () => {
    const map = createMap(2, 1);
    const history = new History(() => map);
    history.begin();
    history.record(setTile(map, 0, 0, 0, 5));
    history.begin();
    history.record(setTile(map, 0, 1, 0, 6));
    history.end();
    expect(history.undo()).toBe(true);
    expect(Array.from(map.layers[0]!.data)).toEqual([0, 0]);
  });

  it('undo during a stroke closes it first, so nothing undone comes back', () => {
    const map = createMap(2, 1);
    const history = new History(() => map);
    history.record(setTile(map, 0, 0, 0, 1));
    history.begin();
    history.record(setTile(map, 0, 0, 0, 2));
    expect(history.undo()).toBe(true);
    expect(Array.from(map.layers[0]!.data)).toEqual([1, 0]);
    // The stroke goes on after the undo and is its own step.
    history.record(setTile(map, 0, 1, 0, 3));
    history.end();
    expect(history.undo()).toBe(true);
    expect(Array.from(map.layers[0]!.data)).toEqual([1, 0]);
    expect(history.undo()).toBe(true);
    expect(Array.from(map.layers[0]!.data)).toEqual([0, 0]);
    expect(history.undo()).toBe(false);
  });

  it('redo during a stroke with new edits does nothing', () => {
    const map = createMap(2, 1);
    const history = new History(() => map);
    history.record(setTile(map, 0, 0, 0, 1));
    history.undo();
    history.begin();
    history.record(setTile(map, 0, 1, 0, 2));
    expect(history.redo()).toBe(false);
    history.end();
    expect(Array.from(map.layers[0]!.data)).toEqual([0, 2]);
  });

  it('drops redo after a new edit', () => {
    const map = createMap(2, 2);
    const history = new History(() => map);
    history.record(setTile(map, 0, 0, 0, 1));
    history.undo();
    history.record(setTile(map, 0, 1, 1, 2));
    expect(history.redo()).toBe(false);
  });
});

describe('tmj', () => {
  it('round trips a map', () => {
    const map = createMap(6, 4);
    setTile(map, 0, 1, 2, 4);
    setTile(map, 1, 5, 3, 13);
    map.layers[1]!.visible = false;

    const tmj = toTmj(map, GENERATED_TILESET);
    expect(tmj).toMatchObject({ orientation: 'isometric', tilewidth: 64, tileheight: 32 });
    expect(tmj.tilesets[0]).toMatchObject({ image: 'isotiles.png', imageheight: 192 });

    const back = fromTmj(JSON.parse(JSON.stringify(tmj)));
    expect(back.map).toEqual(map);
    expect(back.tileset).toEqual(GENERATED_TILESET);
  });

  it('reads layers inside groups, strips flip flags and maps firstgid', () => {
    const tmj = toTmj(createMap(2, 1), GENERATED_TILESET);
    tmj.tilesets[0]!.firstgid = 10;
    tmj.layers = [
      {
        type: 'group',
        name: 'Level',
        layers: [{ type: 'tilelayer', name: 'Floor', data: [10 | 0x80000000, 12] }],
      },
    ];
    const { map } = fromTmj(tmj);
    expect(map.layers.map((l) => l.name)).toEqual(['Level/Floor']);
    expect(Array.from(map.layers[0]!.data)).toEqual([1, 3]);
  });

  it('hides the layers of a hidden group', () => {
    const tmj = toTmj(createMap(1, 1), GENERATED_TILESET);
    tmj.layers = [
      {
        type: 'group',
        name: 'g',
        visible: false,
        layers: [{ type: 'tilelayer', name: 'a', visible: true, data: [1] }],
      },
      { type: 'tilelayer', name: 'b', data: [1] },
    ];
    expect(fromTmj(tmj).map.layers.map((l) => [l.name, l.visible])).toEqual([
      ['g/a', false],
      ['b', true],
    ]);
  });

  it('explains what it cannot read', () => {
    const base = () => toTmj(createMap(1, 1), GENERATED_TILESET);
    expect(() => fromTmj({ ...base(), orientation: 'orthogonal' })).toThrow(/only isometric/);
    expect(() => fromTmj({ ...base(), infinite: true })).toThrow(/infinite/);
    expect(() => fromTmj({ ...base(), tilesets: [{ firstgid: 1, source: 'a.tsj' }] })).toThrow(
      /embed it/,
    );
    const b64 = base();
    b64.layers[0] = { type: 'tilelayer', name: 'x', data: 'AAAA', encoding: 'base64' };
    expect(() => fromTmj(b64)).toThrow(/CSV/);
    expect(() => fromTmj({})).toThrow(TmjError);
  });
});

describe('fillRect', () => {
  it('fills between corners given in any order', () => {
    const map = createMap(4, 4);
    expect(fillRect(map, 0, { x: 2, y: 3 }, { x: 1, y: 1 }, 6)).toHaveLength(6);
    expect(getTile(map, 0, 1, 1)).toBe(6);
    expect(getTile(map, 0, 2, 3)).toBe(6);
    expect(getTile(map, 0, 0, 1)).toBe(0);
    expect(fillRect(map, 0, { x: 1, y: 1 }, { x: 2, y: 3 }, 6)).toEqual([]);
  });
});
