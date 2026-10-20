import { TmjError, type Tmj } from './tmj.js';

/** Decompresses zlib ("zlib") or gzip ("gzip") data. */
export type Decompress = (data: Uint8Array, format: 'zlib' | 'gzip') => Promise<Uint8Array>;

/**
 * Converts a TMX (XML) map into the same shape as a Tiled JSON map, so the
 * rest of the editor only deals with one format. Tile data may be CSV or
 * base64, uncompressed, zlib or gzip.
 */
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
      };
    });

  const layers = async (parent: Element): Promise<Tmj['layers']> => {
    const out: Tmj['layers'] = [];
    for (const el of [...parent.children]) {
      if (el.tagName === 'group') {
        out.push({ type: 'group', name: el.getAttribute('name') ?? '', layers: await layers(el) });
      } else if (el.tagName === 'layer') {
        const data = el.querySelector(':scope > data');
        out.push({
          type: 'tilelayer',
          name: el.getAttribute('name') ?? '',
          width: int(el, 'width'),
          height: int(el, 'height'),
          visible: el.getAttribute('visible') !== '0',
          data: data ? await readData(data) : [],
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
