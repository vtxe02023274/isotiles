import { newLayer, type TileMap } from './map.js';
import type { TilesetInfo } from './tileset.js';

/** Tiled stores flip flags in the top bits of a gid. */
const GID_MASK = 0x0fffffff;

interface TmjLayer {
  type: string;
  name: string;
  width?: number;
  height?: number;
  visible?: boolean;
  data?: number[] | string;
  encoding?: string;
  layers?: TmjLayer[];
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
}

export interface Tmj {
  type: 'map';
  orientation: string;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  infinite?: boolean;
  layers: TmjLayer[];
  tilesets: TmjTileset[];
  [key: string]: unknown;
}

/** Writes a Tiled JSON map with one embedded tileset. */
export function toTmj(map: TileMap, tileset: TilesetInfo): Tmj {
  const rows = Math.ceil(tileset.tileCount / tileset.columns);
  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.12.2',
    orientation: 'isometric',
    renderorder: 'right-down',
    width: map.width,
    height: map.height,
    tilewidth: map.tileWidth,
    tileheight: map.tileHeight,
    infinite: false,
    nextlayerid: map.layers.length + 1,
    nextobjectid: 1,
    layers: map.layers.map((layer, i) => ({
      type: 'tilelayer',
      id: i + 1,
      name: layer.name,
      x: 0,
      y: 0,
      width: map.width,
      height: map.height,
      opacity: 1,
      visible: layer.visible,
      data: Array.from(layer.data),
    })),
    tilesets: [
      {
        firstgid: 1,
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
 * Reads an isometric Tiled JSON map. Supports CSV tile layers (the default
 * in Tiled) inside groups, with one embedded image tileset. Flip flags are
 * dropped since the editor has no tile rotation.
 */
export function fromTmj(json: unknown): ImportedMap {
  const tmj = json as Tmj;
  if (tmj?.type !== 'map') throw new TmjError('not a Tiled JSON map');
  if (tmj.orientation !== 'isometric') {
    throw new TmjError(`orientation is ${tmj.orientation}, only isometric maps are supported`);
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
    layers: [],
  };

  const visit = (layers: TmjLayer[], prefix: string) => {
    for (const l of layers) {
      if (l.type === 'group') {
        visit(l.layers ?? [], `${prefix}${l.name}/`);
        continue;
      }
      if (l.type !== 'tilelayer') continue;
      if (typeof l.data === 'string' || l.encoding) {
        throw new TmjError(`layer ${l.name}: set the layer format to CSV in Tiled`);
      }
      const layer = newLayer(prefix + l.name, map.width, map.height);
      layer.visible = l.visible !== false;
      const data = l.data ?? [];
      for (let i = 0; i < layer.data.length && i < data.length; i++) {
        const gid = data[i]! & GID_MASK;
        const local = gid - ts.firstgid + 1;
        layer.data[i] = gid && local > 0 && local <= tileCount ? local : 0;
      }
      map.layers.push(layer);
    }
  };
  visit(tmj.layers, '');
  if (!map.layers.length) map.layers.push(newLayer('Ground', map.width, map.height));

  return {
    map,
    tileset: {
      name: ts.name ?? 'tileset',
      image: ts.image,
      tileWidth: ts.tilewidth,
      tileHeight: ts.tileheight,
      columns: ts.columns,
      tileCount,
    },
  };
}
