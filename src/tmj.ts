import { GID_MASK, newLayer, type KeptLayer, type TileMap } from './map.js';
import type { TilesetInfo } from './tileset.js';

interface TmjLayer {
  type: string;
  name: string;
  width?: number;
  height?: number;
  visible?: boolean;
  data?: number[] | string;
  encoding?: string;
  layers?: TmjLayer[];
  id?: number;
  [key: string]: unknown;
}

interface TmjTileset {
  firstgid: number;
  source?: string;
  name?: string;
  image?: string;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
  imagewidth?: number;
  imageheight?: number;
  margin?: number;
  spacing?: number;
  tileoffset?: { x: number; y: number };
}

export interface Tmj {
  type: 'map';
  orientation: string;
  staggeraxis?: string;
  staggerindex?: string;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite?: boolean;
  layers: TmjLayer[];
  tilesets: TmjTileset[];
  [key: string]: unknown;
}

/** Map fields toTmj works out itself. Any other field read from a file is kept. */
const MAP_FIELDS = new Set([
  'type',
  'version',
  'tiledversion',
  'orientation',
  'staggeraxis',
  'staggerindex',
  'width',
  'height',
  'tilewidth',
  'tileheight',
  'infinite',
  'nextlayerid',
  'layers',
  'tilesets',
]);
const MAP_DEFAULTS: Record<string, unknown> = { renderorder: 'right-down', nextobjectid: 1 };

/** Tile layer fields toTmj works out itself. */
const LAYER_FIELDS = new Set([
  'type',
  'id',
  'name',
  'x',
  'y',
  'width',
  'height',
  'visible',
  'data',
]);
const LAYER_DEFAULTS: Record<string, unknown> = { opacity: 1 };

/** Tileset fields toTmj works out itself. */
const TILESET_FIELDS = new Set([
  'firstgid',
  'source',
  'name',
  'image',
  'imagewidth',
  'imageheight',
  'tilewidth',
  'tileheight',
  'tilecount',
  'columns',
  'margin',
  'spacing',
  'tileoffset',
]);

/** The fields of `from` that are not known and differ from what toTmj writes anyway. */
function otherFields(from: object, known: Set<string>, defaults: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(from)) {
    if (known.has(key) || value === undefined) continue;
    if (JSON.stringify(value) === JSON.stringify(defaults[key])) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Writes a Tiled JSON map with one embedded tileset. For an imported map the
 * layers, groups and fields the editor does not edit are written back as they
 * were read; layer ids are numbered again.
 */
export function toTmj(map: TileMap, tileset: TilesetInfo): Tmj {
  const rows = Math.ceil(tileset.tileCount / tileset.columns);

  let id = 1;
  const written = new Set<number>();
  const tileLayer = (i: number, prefix: string): TmjLayer => {
    const layer = map.layers[i]!;
    written.add(i);
    return {
      type: 'tilelayer',
      id: id++,
      name: layer.name.startsWith(prefix) ? layer.name.slice(prefix.length) : layer.name,
      x: 0,
      y: 0,
      width: map.width,
      height: map.height,
      opacity: 1,
      ...layer.extra,
      // A layer shown in its file but hidden by its group stays shown.
      visible: layer.visible || layer.extra?.visible === true,
      data: Array.from(layer.data),
    };
  };
  const walk = (kept: KeptLayer[], prefix: string): TmjLayer[] =>
    kept.flatMap((node): TmjLayer[] => {
      if (typeof node === 'number')
        return node < map.layers.length ? [tileLayer(node, prefix)] : [];
      const layer = { ...node, id: id++ } as TmjLayer;
      if (layer.type === 'group') layer.layers = walk(node.layers ?? [], `${prefix}${layer.name}/`);
      return [layer];
    });
  const layers = walk(map.extra?.layers ?? [], '');
  // Layers added in the editor go on top.
  map.layers.forEach((_, i) => written.has(i) || layers.push(tileLayer(i, '')));

  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.12.2',
    orientation: map.stagger ? 'staggered' : 'isometric',
    ...(map.stagger ? { staggeraxis: map.stagger.axis, staggerindex: map.stagger.index } : {}),
    renderorder: 'right-down',
    width: map.width,
    height: map.height,
    tilewidth: map.tileWidth,
    tileheight: map.tileHeight,
    infinite: false,
    nextobjectid: 1,
    ...map.extra?.fields,
    nextlayerid: id,
    layers,
    tilesets: [
      {
        firstgid: 1,
        ...tileset.extra,
        name: tileset.name,
        image: tileset.image,
        imagewidth: tileset.columns * tileset.tileWidth,
        imageheight: rows * tileset.tileHeight,
        tilewidth: tileset.tileWidth,
        tileheight: tileset.tileHeight,
        tilecount: tileset.tileCount,
        columns: tileset.columns,
        margin: 0,
        spacing: 0,
        ...(tileset.offsetX || tileset.offsetY
          ? { tileoffset: { x: tileset.offsetX ?? 0, y: tileset.offsetY ?? 0 } }
          : {}),
      },
    ],
  };
}

export class TmjError extends Error {}

export interface ImportedMap {
  map: TileMap;
  tileset: TilesetInfo;
}

/**
 * Reads an isometric or staggered Tiled JSON map. Supports CSV tile layers (the default
 * in Tiled) inside groups, with one embedded image tileset. Everything else
 * (other layer types, properties, layer opacity and offsets, flip flags) is
 * kept on the map so toTmj can write it back.
 */
export function fromTmj(json: unknown): ImportedMap {
  const tmj = json as Tmj;
  if (tmj?.type !== 'map') throw new TmjError('not a Tiled JSON map');
  if (tmj.orientation !== 'isometric' && tmj.orientation !== 'staggered') {
    throw new TmjError(
      `orientation is ${tmj.orientation}, only isometric and staggered maps are supported`,
    );
  }
  if (tmj.infinite) throw new TmjError('infinite maps are not supported');
  if (tmj.tilesets.length !== 1) {
    throw new TmjError(`map has ${tmj.tilesets.length} tilesets, exactly one is supported`);
  }
  const ts = tmj.tilesets[0]!;
  if (ts.source) throw new TmjError(`external tileset ${ts.source}: embed it in Tiled first`);
  const tileCount = ts.tilecount;
  if (!ts.image || !ts.columns || !ts.tilewidth || !ts.tileheight || !tileCount) {
    throw new TmjError('tileset must be a single image tileset');
  }
  if (ts.margin || ts.spacing)
    throw new TmjError('tilesets with margin or spacing are not supported');

  const map: TileMap = {
    width: tmj.width,
    height: tmj.height,
    tileWidth: tmj.tilewidth,
    tileHeight: tmj.tileheight,
    ...(tmj.orientation === 'staggered'
      ? {
          stagger: {
            axis: tmj.staggeraxis === 'x' ? 'x' : 'y',
            index: tmj.staggerindex === 'even' ? 'even' : 'odd',
          },
        }
      : {}),
    layers: [],
  };

  // A hidden group hides everything inside it, like in Tiled.
  const visit = (layers: TmjLayer[], prefix: string, visible: boolean): KeptLayer[] => {
    const kept: KeptLayer[] = [];
    for (const l of layers) {
      // Layer ids are numbered again on export.
      const { layers: children, ...rest } = l;
      delete rest.id;
      if (l.type === 'group') {
        const shown = visible && l.visible !== false;
        kept.push({ ...rest, layers: visit(children ?? [], `${prefix}${l.name}/`, shown) });
        continue;
      }
      if (l.type !== 'tilelayer') {
        kept.push(rest);
        continue;
      }
      if (typeof l.data === 'string' || l.encoding) {
        throw new TmjError(`layer ${l.name}: set the layer format to CSV in Tiled`);
      }
      const layer = newLayer(prefix + l.name, map.width, map.height);
      layer.visible = visible && l.visible !== false;
      const data = l.data ?? [];
      for (let i = 0; i < layer.data.length && i < data.length; i++) {
        const gid = data[i]! & GID_MASK;
        const local = gid - ts.firstgid + 1;
        // Flip flags stay in the top bits.
        layer.data[i] = gid && local > 0 && local <= tileCount ? local | (data[i]! & ~GID_MASK) : 0;
      }
      const extra = otherFields(l, LAYER_FIELDS, LAYER_DEFAULTS);
      if (layer.visible !== (l.visible !== false)) extra.visible = true;
      if (Object.keys(extra).length) layer.extra = extra;
      kept.push(map.layers.length);
      map.layers.push(layer);
    }
    return kept;
  };
  const kept = visit(tmj.layers, '', true);
  if (!map.layers.length) map.layers.push(newLayer('Ground', map.width, map.height));

  // The layer tree is only kept when it is more than the tile layers in order.
  const plain = kept.every((node, i) => node === i);
  const fields = otherFields(tmj, MAP_FIELDS, MAP_DEFAULTS);
  const tilesetExtra = otherFields(ts, TILESET_FIELDS, {});
  if (!plain || Object.keys(fields).length) {
    map.extra = { fields, ...(plain ? {} : { layers: kept }) };
  }

  return {
    map,
    tileset: {
      name: ts.name ?? 'tileset',
      image: ts.image,
      tileWidth: ts.tilewidth,
      tileHeight: ts.tileheight,
      columns: ts.columns,
      tileCount,
      ...(ts.tileoffset ? { offsetX: ts.tileoffset.x, offsetY: ts.tileoffset.y } : {}),
      ...(Object.keys(tilesetExtra).length ? { extra: tilesetExtra } : {}),
    },
  };
}
