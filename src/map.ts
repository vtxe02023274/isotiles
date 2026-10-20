import { inBounds, neighbours, type Grid, type Stagger } from './iso.js';

/** Tiled keeps flip and rotation flags in the top four bits of a gid. */
export const GID_MASK = 0x0fffffff;

export interface Layer {
  name: string;
  visible: boolean;
  /**
   * Tile ids, row by row. 0 is empty, otherwise tile index + 1 like Tiled gids,
   * with the flip flags of an imported map kept in the top bits.
   */
  data: Uint32Array;
  /** Fields of an imported Tiled layer the editor does not edit, such as opacity. */
  extra?: Record<string, unknown>;
}

/**
 * An imported Tiled layer the editor keeps as it is: a tile layer, given as
 * the index of its editor layer, or any other layer as read, with groups
 * holding more of them.
 */
export type KeptLayer =
  number | { type: string; name: string; layers?: KeptLayer[]; [key: string]: unknown };

export interface TileMap extends Grid {
  layers: Layer[];
  /** Parts of an imported Tiled map the editor does not edit, written back on export. */
  extra?: {
    /** Map fields such as properties. */
    fields: Record<string, unknown>;
    /** The imported layer tree. Editor layers missing from it are added at the end. */
    layers?: KeptLayer[];
  };
}

export function createMap(
  width: number,
  height: number,
  tileWidth = 64,
  tileHeight = 32,
  stagger?: Stagger,
): TileMap {
  return {
    width,
    height,
    tileWidth,
    tileHeight,
    ...(stagger ? { stagger } : {}),
    layers: [newLayer('Ground', width, height), newLayer('Objects', width, height)],
  };
}

export function newLayer(name: string, width: number, height: number): Layer {
  return { name, visible: true, data: new Uint32Array(width * height) };
}

export function getTile(map: TileMap, layer: number, cx: number, cy: number): number {
  return map.layers[layer]!.data[cy * map.width + cx]!;
}

/** A change to one cell, kept for undo. */
export interface CellChange {
  layer: number;
  index: number;
  before: number;
  after: number;
}

/**
 * Changed cells packed four numbers per cell (layer, index, before, after)
 * into one typed array, so a fill over a big map stays small in memory.
 */
export class Changes {
  length = 0;
  private cells = new Uint32Array(64);

  add(layer: number, index: number, before: number, after: number): void {
    this.reserve(1);
    const at = this.length * 4;
    this.cells[at] = layer;
    this.cells[at + 1] = index;
    this.cells[at + 2] = before;
    this.cells[at + 3] = after;
    this.length++;
  }

  push(changes: CellChange | Changes): void {
    if (changes instanceof Changes) {
      this.reserve(changes.length);
      this.cells.set(changes.cells.subarray(0, changes.length * 4), this.length * 4);
      this.length += changes.length;
    } else {
      this.add(changes.layer, changes.index, changes.before, changes.after);
    }
  }

  private reserve(count: number): void {
    const needed = (this.length + count) * 4;
    if (needed <= this.cells.length) return;
    const grown = new Uint32Array(Math.max(needed, this.cells.length * 2));
    grown.set(this.cells);
    this.cells = grown;
  }

  /** A copy without the spare room at the end. */
  compact(): Changes {
    const copy = new Changes();
    copy.cells = this.cells.slice(0, this.length * 4);
    copy.length = this.length;
    return copy;
  }

  /** Writes the cells back as they were before (undo) or after the change. */
  apply(map: TileMap, undo: boolean): void {
    const c = this.cells;
    if (undo) {
      for (let at = (this.length - 1) * 4; at >= 0; at -= 4) {
        map.layers[c[at]!]!.data[c[at + 1]!] = c[at + 2]!;
      }
    } else {
      for (let at = 0; at < this.length * 4; at += 4) {
        map.layers[c[at]!]!.data[c[at + 1]!] = c[at + 3]!;
      }
    }
  }

  *[Symbol.iterator](): IterableIterator<CellChange> {
    const c = this.cells;
    for (let at = 0; at < this.length * 4; at += 4) {
      yield { layer: c[at]!, index: c[at + 1]!, before: c[at + 2]!, after: c[at + 3]! };
    }
  }
}

export function setTile(
  map: TileMap,
  layer: number,
  cx: number,
  cy: number,
  gid: number,
): CellChange | undefined {
  const data = map.layers[layer]!.data;
  const index = cy * map.width + cx;
  const before = data[index]!;
  if (before === gid) return undefined;
  data[index] = gid;
  return { layer, index, before, after: gid };
}

/** Sets every cell between two corners, inclusive, in any order. */
export function fillRect(
  map: TileMap,
  layer: number,
  a: { x: number; y: number },
  b: { x: number; y: number },
  gid: number,
): Changes {
  const changes = new Changes();
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
      const change = setTile(map, layer, x, y, gid);
      if (change) changes.push(change);
    }
  }
  return changes;
}

/** Replaces the connected area of equal tiles around (cx, cy), 4-way. */
export function floodFill(
  map: TileMap,
  layer: number,
  cx: number,
  cy: number,
  gid: number,
): Changes {
  const changes = new Changes();
  const data = map.layers[layer]!.data;
  const target = data[cy * map.width + cx]!;
  if (target === gid) return changes;

  const stack = [cy * map.width + cx];
  while (stack.length) {
    const index = stack.pop()!;
    if (data[index] !== target) continue;
    data[index] = gid;
    changes.add(layer, index, target, gid);
    const x = index % map.width;
    const y = (index - x) / map.width;
    for (const n of neighbours(map, x, y)) {
      if (inBounds(map, n.x, n.y)) stack.push(n.y * map.width + n.x);
    }
  }
  return changes;
}

/** What one step costs against the history cap: its cells plus the array itself. */
const stepCost = (group: Changes) => group.length + 8;

/**
 * Undo history. Edits made during one drag are grouped, so a stroke is
 * undone in one step. The history is capped by the number of cells it holds
 * (about 16 bytes each); the oldest steps go first, the latest always stays.
 */
export class History {
  private readonly undoStack: Changes[] = [];
  private readonly redoStack: Changes[] = [];
  private open: Changes | undefined;
  private held = 0;

  constructor(
    private readonly map: () => TileMap,
    private readonly maxCells = 1 << 22,
  ) {}

  /** Cells held for undo and redo, counted with stepCost. */
  get size(): number {
    return this.held;
  }

  /** Starts a stroke. If one is already open it keeps collecting into it. */
  begin(): void {
    this.open ??= new Changes();
  }

  record(changes: CellChange | Changes | undefined): void {
    if (!changes || (changes instanceof Changes && !changes.length)) return;
    if (this.open) {
      this.open.push(changes);
    } else {
      const group = new Changes();
      group.push(changes);
      this.push(group);
    }
  }

  end(): void {
    if (this.open?.length) this.push(this.open);
    this.open = undefined;
  }

  undo(): boolean {
    this.flush();
    const group = this.undoStack.pop();
    if (!group) return false;
    group.apply(this.map(), true);
    this.redoStack.push(group);
    return true;
  }

  redo(): boolean {
    this.flush();
    const group = this.redoStack.pop();
    if (!group) return false;
    group.apply(this.map(), false);
    this.undoStack.push(group);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.open = undefined;
    this.held = 0;
  }

  /**
   * Closes the edits of an open stroke as their own step before undo or redo,
   * and keeps the stroke open so the rest of it is the next step.
   */
  private flush(): void {
    if (!this.open?.length) return;
    this.push(this.open);
    this.open = new Changes();
  }

  private push(group: Changes): void {
    for (const dropped of this.redoStack) this.held -= stepCost(dropped);
    this.redoStack.length = 0;
    const kept = group.compact();
    this.undoStack.push(kept);
    this.held += stepCost(kept);
    while (this.held > this.maxCells && this.undoStack.length > 1) {
      this.held -= stepCost(this.undoStack.shift()!);
    }
  }
}
