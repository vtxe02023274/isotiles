// @vitest-environment happy-dom
import { deflateSync, gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fromTmj, toTmj } from '../src/tmj.js';
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

  it('hides the layers of a hidden group', async () => {
    const tmj = await tmxToTmj(
      map(`<group name="g" visible="0"><group name="h"><layer name="a" width="2" height="2"><data encoding="csv">1,1,1,1</data></layer></group></group>
 <group name="v"><layer name="b" width="2" height="2"><data encoding="csv">1,1,1,1</data></layer></group>`),
      decompress,
    );
    expect(fromTmj(tmj).map.layers.map((l) => [l.name, l.visible])).toEqual([
      ['g/h/a', false],
      ['v/b', true],
    ]);
  });

  it('keeps properties, layer settings, objects and image layers through export', async () => {
    const tmj = await tmxToTmj(
      map(`<properties><property name="music" value="town"/></properties>
 <layer id="1" name="a" width="2" height="2" opacity="0.5" offsetx="10" offsety="-8" tintcolor="#ff0000">
  <properties><property name="solid" type="bool" value="true"/><property name="cost" type="int" value="3"/></properties>
  <data encoding="csv">2147483649,2,3,4</data>
 </layer>
 <group id="2" name="g" visible="0" opacity="0.8">
  <objectgroup id="3" name="spawns" class="spawn" draworder="index">
   <object id="4" name="start" type="player" x="32" y="16"><point/></object>
   <object id="5" x="1" y="2" width="30" height="20" rotation="45"><ellipse/><properties><property name="note">two
lines</property></properties></object>
   <object id="6" x="0" y="0"><polygon points="0,0 10,5 -3,8"/></object>
   <object id="7" x="5" y="5" width="80" height="20"><text wrap="1" pixelsize="12">hi</text></object>
  </objectgroup>
 </group>
 <imagelayer id="4" name="sky" opacity="0.3" repeatx="1"><image source="sky.png" width="320" height="240"/></imagelayer>`),
      decompress,
    );
    const imported = fromTmj(tmj);
    const out = toTmj(imported.map, imported.tileset);

    expect(out.properties).toEqual([{ name: 'music', type: 'string', value: 'town' }]);
    expect(out.layers).toMatchObject([
      {
        type: 'tilelayer',
        name: 'a',
        opacity: 0.5,
        offsetx: 10,
        offsety: -8,
        tintcolor: '#ff0000',
        properties: [
          { name: 'solid', type: 'bool', value: true },
          { name: 'cost', type: 'int', value: 3 },
        ],
        data: [0x80000001, 2, 3, 4],
      },
      {
        type: 'group',
        name: 'g',
        visible: false,
        opacity: 0.8,
        layers: [
          {
            type: 'objectgroup',
            name: 'spawns',
            class: 'spawn',
            draworder: 'index',
            objects: [
              { id: 4, name: 'start', type: 'player', x: 32, y: 16, point: true },
              {
                id: 5,
                width: 30,
                height: 20,
                rotation: 45,
                ellipse: true,
                properties: [
                  {
                    name: 'note',
                    type: 'string',
                    value: 'two\nlines',
                  },
                ],
              },
              {
                id: 6,
                polygon: [
                  { x: 0, y: 0 },
                  { x: 10, y: 5 },
                  { x: -3, y: 8 },
                ],
              },
              { id: 7, text: { text: 'hi', wrap: true, pixelsize: 12 } },
            ],
          },
        ],
      },
      { type: 'imagelayer', name: 'sky', opacity: 0.3, repeatx: true, image: 'sky.png' },
    ]);
  });

  it('keeps tileset properties, tile animations and collision shapes through export', async () => {
    const tmx = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" orientation="isometric" renderorder="right-down" width="1" height="1" tilewidth="64" tileheight="32" infinite="0">
 <tileset firstgid="1" name="iso" tilewidth="64" tileheight="64" tilecount="4" columns="4" objectalignment="bottom">
  <properties><property name="biome" value="grass"/></properties>
  <image source="iso.png" trans="ff00ff" width="256" height="64"/>
  <tile id="0" class="water" probability="0.5">
   <properties><property name="speed" type="int" value="2"/></properties>
   <animation><frame tileid="1" duration="100"/><frame tileid="2" duration="150"/></animation>
  </tile>
  <tile id="3">
   <objectgroup draworder="index"><object id="1" x="0" y="32" width="64" height="32"/></objectgroup>
  </tile>
 </tileset>
 <layer name="l" width="1" height="1"><data encoding="csv">1</data></layer>
</map>`;
    const imported = fromTmj(await tmxToTmj(tmx, decompress));
    const ts = toTmj(imported.map, imported.tileset).tilesets[0] as unknown as Record<
      string,
      unknown
    >;
    expect(ts).toMatchObject({
      objectalignment: 'bottom',
      transparentcolor: '#ff00ff',
      properties: [{ name: 'biome', type: 'string', value: 'grass' }],
      tiles: [
        {
          id: 0,
          type: 'water',
          probability: 0.5,
          properties: [{ name: 'speed', type: 'int', value: 2 }],
          animation: [
            { tileid: 1, duration: 100 },
            { tileid: 2, duration: 150 },
          ],
        },
        {
          id: 3,
          objectgroup: {
            type: 'objectgroup',
            draworder: 'index',
            objects: [{ id: 1, x: 0, y: 32, width: 64, height: 32 }],
          },
        },
      ],
    });
    expect(ts.firstgid).toBe(1);
    expect(ts.image).toBe('iso.png');
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
