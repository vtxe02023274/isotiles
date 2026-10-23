import { TmjError, type Tmj } from './tmj.js';

/** Decompresses zlib ("zlib") or gzip ("gzip") data. */
export type Decompress = (data: Uint8Array, format: 'zlib' | 'gzip') => Promise<Uint8Array>;

type Fields = Record<string, unknown>;

/** Attributes Tiled writes as numbers or as 0 / 1; everything else stays a string. */
const NUMBERS = new Set([
  'id',
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'gid',
  'opacity',
  'offsetx',
  'offsety',
  'parallaxx',
  'parallaxy',
  'parallaxoriginx',
  'parallaxoriginy',
  'nextobjectid',
  'nextlayerid',
  'compressionlevel',
  'hexsidelength',
  'pixelsize',
]);
const BOOLEANS = new Set([
  'visible',
  'locked',
  'repeatx',
  'repeaty',
  'wrap',
  'bold',
  'italic',
  'underline',
  'strikeout',
  'kerning',
]);

/** An element's attributes with the value types a Tiled JSON file uses. */
function attributes(el: Element): Fields {
  const out: Fields = {};
  for (const { name, value } of [...el.attributes]) {
    out[name] = NUMBERS.has(name) ? Number(value) : BOOLEANS.has(name) ? value === '1' : value;
  }
  return out;
}

function propertyValue(p: Element): unknown {
  const type = p.getAttribute('type') ?? 'string';
  if (type === 'class') return propertyMap(p);
  // Multi-line strings are written as the element's text.
  const value = p.getAttribute('value') ?? p.textContent ?? '';
  if (type === 'int' || type === 'float' || type === 'object') return Number(value);
  if (type === 'bool') return value === 'true';
  return value;
}

/** The members of a class property, as an object like in Tiled JSON. */
function propertyMap(el: Element): Fields {
  const out: Fields = {};
  for (const p of el.querySelectorAll(':scope > properties > property')) {
    out[p.getAttribute('name') ?? ''] = propertyValue(p);
  }
  return out;
}

/** `{ properties: [...] }` for an element that has any, else nothing. */
function properties(el: Element): Fields {
  const list = [...el.querySelectorAll(':scope > properties > property')].map((p) => {
    const propertytype = p.getAttribute('propertytype');
    return {
      name: p.getAttribute('name') ?? '',
      type: p.getAttribute('type') ?? 'string',
      ...(propertytype ? { propertytype } : {}),
      value: propertyValue(p),
    };
  });
  return list.length ? { properties: list } : {};
}

const points = (text: string | null) =>
  (text ?? '')
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x: x ?? 0, y: y ?? 0 };
    });

function object(el: Element): Fields {
  // Tiled 1.9 renamed the object type attribute to class; JSON still calls it type.
  const { class: cls, type, ...attrs } = attributes(el);
  const out: Fields = {
    id: 0,
    name: '',
    type: cls ?? type ?? '',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    visible: true,
    ...attrs,
    ...properties(el),
  };
  for (const child of el.children) {
    if (child.tagName === 'ellipse' || child.tagName === 'point') out[child.tagName] = true;
    if (child.tagName === 'polygon' || child.tagName === 'polyline') {
      out[child.tagName] = points(child.getAttribute('points'));
    }
    if (child.tagName === 'text')
      out.text = { text: child.textContent ?? '', ...attributes(child) };
  }
  return out;
}

/**
 * Converts a TMX (XML) map into the same shape as a Tiled JSON map, so the
 * rest of the editor only deals with one format. Tile data may be CSV or
 * base64, uncompressed, zlib or gzip. Object groups, image layers and
 * properties are converted too, so they can be written back on export.
 */
/** Tileset attributes the importer reads itself. */
const TILESET_ATTRIBUTES = new Set([
  'firstgid',
  'source',
  'name',
  'tilewidth',
  'tileheight',
  'tilecount',
  'columns',
  'margin',
  'spacing',
  'version',
  'tiledversion',
]);

/** A <tile> of a tileset: class, probability, properties, animation and collision shapes. */
function tile(el: Element): Fields {
  const { class: tileClass, probability, ...rest } = attributes(el);
  const frames = [...el.querySelectorAll(':scope > animation > frame')].map((f) => ({
    tileid: Number(f.getAttribute('tileid') ?? 0),
    duration: Number(f.getAttribute('duration') ?? 0),
  }));
  const collision = el.querySelector(':scope > objectgroup');
  return {
    ...rest,
    ...(tileClass !== undefined ? { type: tileClass } : {}),
    ...(probability !== undefined ? { probability: Number(probability) } : {}),
    ...properties(el),
    ...(frames.length ? { animation: frames } : {}),
    ...(collision
      ? {
          objectgroup: {
            ...attributes(collision),
            type: 'objectgroup',
            objects: [...collision.children].filter((c) => c.tagName === 'object').map(object),
          },
        }
      : {}),
  };
}

/** What Tiled JSON keeps on a tileset beyond the fields the editor uses. */
function tilesetExtras(ts: Element, image: Element | null): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(attributes(ts))) {
    if (!TILESET_ATTRIBUTES.has(key)) out[key] = value;
  }
  if (image?.hasAttribute('trans')) out.transparentcolor = `#${image.getAttribute('trans')}`;
  Object.assign(out, properties(ts));
  const tiles = [...ts.querySelectorAll(':scope > tile')].map(tile);
  if (tiles.length) out.tiles = tiles;
  return out;
}

export async function tmxToTmj(text: string, decompress: Decompress): Promise<Tmj> {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new TmjError('not valid XML');
  const map = doc.documentElement;
  if (map.tagName !== 'map') throw new TmjError('not a Tiled map (no <map> element)');

  const int = (el: Element, name: string, fallback = 0) => {
    const v = el.getAttribute(name);
    return v === null ? fallback : Number(v);
  };

  const tilesets = [...map.children]
    .filter((el) => el.tagName === 'tileset')
    .map((ts) => {
      const image = ts.querySelector(':scope > image');
      const offset = ts.querySelector(':scope > tileoffset');
      // Old files leave out columns and tilecount; work them out from the image.
      const tw = int(ts, 'tilewidth');
      const th = int(ts, 'tileheight');
      const columns =
        int(ts, 'columns') || (image && tw ? Math.floor(int(image, 'width') / tw) : 0);
      const rows = image && th ? Math.floor(int(image, 'height') / th) : 0;
      return {
        firstgid: int(ts, 'firstgid'),
        source: ts.getAttribute('source') ?? undefined,
        name: ts.getAttribute('name') ?? undefined,
        image: image?.getAttribute('source') ?? undefined,
        imagewidth: image ? int(image, 'width') : undefined,
        imageheight: image ? int(image, 'height') : undefined,
        tilewidth: tw,
        tileheight: th,
        tilecount: int(ts, 'tilecount') || columns * rows,
        columns,
        margin: int(ts, 'margin'),
        spacing: int(ts, 'spacing'),
        ...(offset ? { tileoffset: { x: int(offset, 'x'), y: int(offset, 'y') } } : {}),
        ...tilesetExtras(ts, image),
      };
    });

  const layers = async (parent: Element): Promise<Tmj['layers']> => {
    const out: Tmj['layers'] = [];
    for (const el of [...parent.children]) {
      const common = { name: '', ...attributes(el), ...properties(el) };
      if (el.tagName === 'group') {
        out.push({ ...common, type: 'group', layers: await layers(el) });
      } else if (el.tagName === 'layer') {
        const data = el.querySelector(':scope > data');
        out.push({ ...common, type: 'tilelayer', data: data ? await readData(data) : [] });
      } else if (el.tagName === 'objectgroup') {
        const objects = [...el.children].filter((c) => c.tagName === 'object').map(object);
        out.push({ ...common, type: 'objectgroup', objects });
      } else if (el.tagName === 'imagelayer') {
        const image = el.querySelector(':scope > image');
        out.push({
          ...common,
          type: 'imagelayer',
          image: image?.getAttribute('source') ?? '',
          ...(image?.hasAttribute('width')
            ? { imagewidth: int(image, 'width'), imageheight: int(image, 'height') }
            : {}),
          ...(image?.hasAttribute('trans')
            ? { transparentcolor: `#${image.getAttribute('trans')}` }
            : {}),
        });
      }
    }
    return out;
  };

  const readData = async (data: Element): Promise<number[]> => {
    const encoding = data.getAttribute('encoding');
    const compression = data.getAttribute('compression');
    const text = data.textContent?.trim() ?? '';
    if (data.querySelector('chunk')) throw new TmjError('infinite maps are not supported');
    if (encoding === 'csv') return text.split(',').map((v) => Number(v.trim()) || 0);
    if (encoding !== 'base64') {
      // The old plain XML format: one <tile gid="..."/> per cell.
      return [...data.querySelectorAll('tile')].map((t) => int(t, 'gid'));
    }
    let bytes: Uint8Array = Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
    if (compression === 'zlib' || compression === 'gzip')
      bytes = await decompress(bytes, compression);
    else if (compression)
      throw new TmjError(`${compression} compressed layers are not supported, use CSV`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const gids: number[] = [];
    for (let i = 0; i + 4 <= bytes.length; i += 4) gids.push(view.getUint32(i, true));
    return gids;
  };

  return {
    // Map attributes such as backgroundcolor and nextobjectid, kept on export.
    ...attributes(map),
    ...properties(map),
    type: 'map',
    orientation: map.getAttribute('orientation') ?? 'orthogonal',
    staggeraxis: map.getAttribute('staggeraxis') ?? undefined,
    staggerindex: map.getAttribute('staggerindex') ?? undefined,
    width: int(map, 'width'),
    height: int(map, 'height'),
    tilewidth: int(map, 'tilewidth'),
    tileheight: int(map, 'tileheight'),
    infinite: map.getAttribute('infinite') === '1',
    layers: await layers(map),
    tilesets,
  };
}
