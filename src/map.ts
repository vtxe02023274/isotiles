import type { Grid } from './iso.js';

export interface Layer {
  name: string;
  visible: boolean;
  /** Tile ids, row by row. 0 is empty, otherwise tile index + 1 like Tiled gids. */
  data: Uint32Array;
}

export interface TileMap extends Grid {
  layers: Layer[];
}

export function createMap(width: number, height: number, tileWidth = 64, tileHeight = 32): TileMap {
  return {
    width,
    height,
    tileWidth,
    tileHeight,
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

/** Replaces the connected area of equal tiles around (cx, cy), 4-way. */
export function floodFill(
  map: TileMap,
  layer: number,
  cx: number,
  cy: number,
  gid: number,
): CellChange[] {
  const data = map.layers[layer]!.data;
  const target = data[cy * map.width + cx]!;
  if (target === gid) return [];

  const changes: CellChange[] = [];
  const stack = [cy * map.width + cx];
  while (stack.length) {
    const index = stack.pop()!;
    if (data[index] !== target) continue;
    data[index] = gid;
    changes.push({ layer, index, before: target, after: gid });
    const x = index % map.width;
    const y = (index - x) / map.width;
    if (x > 0) stack.push(index - 1);
    if (x < map.width - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - map.width);
    if (y < map.height - 1) stack.push(index + map.width);
  }
  return changes;
}

/**
 * Undo history. Edits made during one drag are grouped, so a stroke is
 * undone in one step.
 */
export class History {
  private readonly undoStack: CellChange[][] = [];
  private readonly redoStack: CellChange[][] = [];
  private open: CellChange[] | undefined;

  constructor(
    private readonly map: () => TileMap,
    private readonly limit = 200,
  ) {}

  begin(): void {
    this.open = [];
  }

  record(changes: CellChange | CellChange[] | undefined): void {
    if (!changes) return;
    const list = Array.isArray(changes) ? changes : [changes];
    if (!list.length) return;
    if (this.open) {
      this.open.push(...list);
    } else {
      this.push(list);
    }
  }

  end(): void {
    if (this.open?.length) this.push(this.open);
    this.open = undefined;
  }

  undo(): boolean {
    const group = this.undoStack.pop();
    if (!group) return false;
    for (let i = group.length - 1; i >= 0; i--) this.apply(group[i]!, true);
    this.redoStack.push(group);
    return true;
  }

  redo(): boolean {
    const group = this.redoStack.pop();
    if (!group) return false;
    for (const change of group) this.apply(change, false);
    this.undoStack.push(group);
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.open = undefined;
  }

  private push(group: CellChange[]): void {
    this.undoStack.push(group);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  private apply(change: CellChange, undo: boolean): void {
    this.map().layers[change.layer]!.data[change.index] = undo ? change.before : change.after;
  }
}
