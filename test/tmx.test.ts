// @vitest-environment happy-dom
import { deflateSync, gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fromTmj } from '../src/tmj.js';
import { tmxToTmj } from '../src/tmx.js';

const decompress = async (data: Uint8Array, format: 'zlib' | 'gzip') =>
  new Uint8Array(format === 'zlib' ? inflateSync(data) : gunzipSync(data));

const gidsBase64 = (gids: number[], compress?: (b: Buffer) => Buffer) => {
  const b = Buffer.alloc(gids.length * 4);
  gids.forEach((g, i) => b.writeUInt32LE(g, i * 4));
  return (compress ? compress(b) : b).toString('base64');
};

const map = (layers: string) => `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="isometric" renderorder="right-down" width="2" height="2" tilewidth="64" tileheight="32" infinite="0">
 <tileset firstgid="1" name="iso" tilewidth="64" tileheight="64">
  <tileoffset x="0" y="16"/>
  <image source="iso.png" width="256" height="384"/>
 </tileset>
${layers}
</map>`;

describe('tmxToTmj', () => {
  it('reads CSV, base64, zlib and gzip layers and the tile offset', async () => {
    const tmj = await tmxToTmj(
      map(`<layer name="csv" width="2" height="2"><data encoding="csv">1,2,
3,4</data></layer>
 <group name="g"><layer name="zlib" width="2" height="2" visible="0"><data encoding="base64" compression="zlib">${gidsBase64([5, 6, 7, 8], deflateSync)}</data></layer></group>
 <layer name="gzip" width="2" height="2"><data encoding="base64" compression="gzip">${gidsBase64([9, 0, 0, 24], gzipSync)}</data></layer>
 <layer name="raw" width="2" height="2"><data encoding="base64">${gidsBase64([1, 1, 1, 1])}</data></layer>`),
      decompress,
    );
    const { map: m, tileset } = fromTmj(tmj);
    expect(m.layers.map((l) => [l.name, l.visible, Array.from(l.data)])).toEqual([
      ['csv', true, [1, 2, 3, 4]],
      ['g/zlib', false, [5, 6, 7, 8]],
      ['gzip', true, [9, 0, 0, 24]],
      ['raw', true, [1, 1, 1, 1]],
    ]);
    // No columns or tilecount in the file: 256 / 64 = 4 columns, 384 / 64 = 6 rows.
    expect(tileset).toMatchObject({ columns: 4, tileCount: 24, offsetX: 0, offsetY: 16 });
  });

  it('rejects what it cannot read', async () => {
    await expect(tmxToTmj('<nope/>', decompress)).rejects.toThrow(/no <map>/);
    await expect(
      tmxToTmj(
        map(
          '<layer name="z" width="2" height="2"><data encoding="base64" compression="zstd">AAAA</data></layer>',
        ),
        decompress,
      ),
    ).rejects.toThrow(/zstd/);
  });
});
