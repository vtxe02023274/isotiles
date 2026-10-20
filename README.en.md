# isotiles

[中文](README.md)

Draw isometric tile maps in the browser and save them as Tiled .tmj files, ready for Tiled and any engine that loads Tiled maps.

Use it online: https://vtxe02023274.github.io/isotiles/

![editor](docs/screenshot.png)

The same map exported and rendered by Tiled's `tmxrasterizer`, with the same positions and overlap:

![rendered by Tiled](docs/tiled-render.png)

## Features

- Paint, erase, fill, rectangle and pick, and a whole drag undoes in one step
- Multiple layers that can be hidden
- 16 built in tiles (ground, blocks, trees, a lamp post), all drawn in code with no third party art
- Tiles taller than the grid (walls, trees) sit on the bottom of their cell, the same way Tiled draws them
- Exports the whole map as a PNG
- Exports .tmj plus a tileset PNG; opens isometric maps saved by Tiled as .tmj or .tmx (CSV, base64, zlib and gzip layers, one image tileset, tile offsets and groups), including Tiled's own `isometric_grass_and_water.tmx` example
- The current map is kept in the browser between visits

| Action                                  | Keys                        |
| --------------------------------------- | --------------------------- |
| Paint / erase / fill / rectangle / pick | B / E / F / R / I           |
| Pan                                     | right drag, or Space + drag |
| Zoom                                    | wheel                       |
| Undo / redo                             | Ctrl+Z / Ctrl+Y             |

## Opening in Tiled

1. Click "Export .tmj" and "Tileset .png" and keep both files in one folder
2. Open map.tmj in Tiled

To use your own tileset, make an isometric map in Tiled with a single image tileset and CSV layer format and save it as .tmj. Pick both the .tmj and the image under "Open .tmj".

## Coordinates

Same as Tiled: (0, 0) is the top cell, x goes down to the right and y down to the left. Hit testing uses the diamond itself, not its bounding box, so clicks near an edge do not land on the neighbour. The math is in `src/iso.ts`.

## Development

```sh
npm install
npm run dev     # http://localhost:5190
npm test
npm run lint
```

## License

MIT
