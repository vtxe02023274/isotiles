import { inBounds, mapPixelSize, pixelToCell, type Point } from './iso.js';
import {
  createMap,
  fillRect,
  floodFill,
  getTile,
  History,
  newLayer,
  setTile,
  type TileMap,
} from './map.js';
import { render, screenToMap, type View } from './render.js';
import {
  drawGeneratedTileset,
  GENERATED_TILE_NAMES,
  GENERATED_TILESET,
  tileRect,
  type Tileset,
} from './tileset.js';
import { fromTmj, toTmj, TmjError } from './tmj.js';
import { tmxToTmj } from './tmx.js';

type Tool = 'paint' | 'erase' | 'fill' | 'rect' | 'pick';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>('#view');
const ctx = canvas.getContext('2d')!;
const palette = $<HTMLCanvasElement>('#palette');
const status = $<HTMLElement>('#status');
const layerSelect = $<HTMLSelectElement>('#layer');
const layerVisible = $<HTMLInputElement>('#layer-visible');
const gridToggle = $<HTMLInputElement>('#grid');

const generated = document.createElement('canvas');
drawGeneratedTileset(generated);
let tileset: Tileset = { ...GENERATED_TILESET, source: generated };
let tileNames: string[] = GENERATED_TILE_NAMES;

let map: TileMap = loadSaved() ?? sampleMap();
const history = new History(() => map);
const view: View = { x: 0, y: 0, zoom: 1 };
let tool: Tool = 'paint';
let selected = 1;
let layer = 0;
let hover: Point | undefined;
let dirty = true;

function sampleMap(): TileMap {
  const m = createMap(16, 16);
  m.layers[0]!.data.fill(1);
  for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) setTile(m, 0, x, y, 4);
  setTile(m, 1, 3, 3, 13);
  setTile(m, 1, 12, 4, 13);
  setTile(m, 1, 4, 12, 14);
  for (let x = 6; x < 10; x++) setTile(m, 1, x, 2, 10);
  return m;
}

// --- persistence -----------------------------------------------------------

const STORAGE_KEY = 'isotiles.map';

function loadSaved(): TileMap | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return fromTmj(JSON.parse(raw)).map;
  } catch {
    return undefined;
  }
}

let saveTimer: number | undefined;
function scheduleSave(): void {
  // Only the built in tileset can be restored without the image file.
  if (tileset.source !== generated) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toTmj(map, tileset)));
    } catch {
      // Storage full or blocked; the map still works for this session.
    }
  }, 500);
}

// --- view ------------------------------------------------------------------

function resize(): void {
  const rect = canvas.parentElement!.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * devicePixelRatio);
  canvas.height = Math.floor(rect.height * devicePixelRatio);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  dirty = true;
}

function centerView(): void {
  const size = mapPixelSize(map);
  view.zoom = Math.min(canvas.width / (size.x + 64), canvas.height / (size.y + 160), 2);
  view.x = size.x / 2 - canvas.width / view.zoom / 2;
  view.y = size.y / 2 - canvas.height / view.zoom / 2 - 32;
  dirty = true;
}

function cellAt(e: PointerEvent | WheelEvent): Point | undefined {
  const r = canvas.getBoundingClientRect();
  const p = screenToMap(
    view,
    (e.clientX - r.left) * devicePixelRatio,
    (e.clientY - r.top) * devicePixelRatio,
  );
  const cell = pixelToCell(map, p.x, p.y);
  return inBounds(map, cell.x, cell.y) ? cell : undefined;
}

// --- editing ---------------------------------------------------------------

function applyTool(cell: Point): void {
  switch (tool) {
    case 'paint':
      history.record(setTile(map, layer, cell.x, cell.y, selected));
      break;
    case 'erase':
      history.record(setTile(map, layer, cell.x, cell.y, 0));
      break;
    case 'fill':
      history.record(floodFill(map, layer, cell.x, cell.y, selected));
      break;
    case 'pick': {
      const gid = getTile(map, layer, cell.x, cell.y);
      if (gid) {
        selected = gid;
        setTool('paint');
        drawPalette();
      }
      break;
    }
  }
  dirty = true;
  scheduleSave();
}

let painting = false;
let rect: { a: Point; b: Point } | undefined;
let panning: { x: number; y: number; vx: number; vy: number } | undefined;
let spaceHeld = false;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || e.button === 2 || spaceHeld) {
    panning = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    return;
  }
  const cell = cellAt(e);
  if (!cell) return;
  if (tool === 'rect') {
    rect = { a: cell, b: cell };
    dirty = true;
    return;
  }
  history.begin();
  painting = tool === 'paint' || tool === 'erase';
  applyTool(cell);
  if (!painting) history.end();
});

canvas.addEventListener('pointermove', (e) => {
  if (panning) {
    view.x = panning.vx - ((e.clientX - panning.x) * devicePixelRatio) / view.zoom;
    view.y = panning.vy - ((e.clientY - panning.y) * devicePixelRatio) / view.zoom;
    dirty = true;
    return;
  }
  const cell = cellAt(e);
  if (cell?.x !== hover?.x || cell?.y !== hover?.y) {
    hover = cell;
    dirty = true;
    if (painting && cell) applyTool(cell);
    if (rect && cell) rect.b = cell;
  }
  updateStatus();
});

const endStroke = () => {
  if (rect) {
    history.record(fillRect(map, layer, rect.a, rect.b, selected));
    rect = undefined;
    dirty = true;
    scheduleSave();
  }
  if (painting) history.end();
  painting = false;
  panning = undefined;
};
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', () => {
  hover = undefined;
  dirty = true;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const sx = (e.clientX - r.left) * devicePixelRatio;
    const sy = (e.clientY - r.top) * devicePixelRatio;
    const before = screenToMap(view, sx, sy);
    view.zoom = Math.min(4, Math.max(0.25, view.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    // Keep the point under the cursor fixed while zooming.
    view.x = before.x - sx / view.zoom;
    view.y = before.y - sy / view.zoom;
    dirty = true;
  },
  { passive: false },
);

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey ? history.redo() : history.undo()) {
      dirty = true;
      scheduleSave();
    }
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    if (history.redo()) {
      dirty = true;
      scheduleSave();
    }
  } else if (e.code === 'Space') {
    spaceHeld = true;
    e.preventDefault();
  } else if (!mod) {
    const key: Record<string, Tool> = { b: 'paint', e: 'erase', f: 'fill', r: 'rect', i: 'pick' };
    const t = key[e.key.toLowerCase()];
    if (t) setTool(t);
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceHeld = false;
});

function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.tool === t));
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.tool as Tool));
});

// --- layers ----------------------------------------------------------------

function refreshLayers(): void {
  layerSelect.replaceChildren(
    ...map.layers.map((l, i) => new Option(l.name, String(i), false, i === layer)),
  );
  layerVisible.checked = map.layers[layer]!.visible;
}
layerSelect.addEventListener('change', () => {
  layer = Number(layerSelect.value);
  layerVisible.checked = map.layers[layer]!.visible;
  dirty = true;
});
layerVisible.addEventListener('change', () => {
  map.layers[layer]!.visible = layerVisible.checked;
  dirty = true;
  scheduleSave();
});
$('#add-layer').addEventListener('click', () => {
  map.layers.push(newLayer(`Layer ${map.layers.length + 1}`, map.width, map.height));
  layer = map.layers.length - 1;
  refreshLayers();
  scheduleSave();
});
gridToggle.addEventListener('change', () => (dirty = true));

// --- palette ---------------------------------------------------------------

const PALETTE_SCALE = 0.75;

function drawPalette(): void {
  const cols = 4;
  const cw = tileset.tileWidth * PALETTE_SCALE;
  const ch = tileset.tileHeight * PALETTE_SCALE;
  palette.width = cols * cw;
  palette.height = Math.ceil(tileset.tileCount / cols) * ch;
  const p = palette.getContext('2d')!;
  p.clearRect(0, 0, palette.width, palette.height);
  for (let i = 0; i < tileset.tileCount; i++) {
    const r = tileRect(tileset, i);
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * ch;
    if (i + 1 === selected) {
      p.fillStyle = 'rgba(255, 224, 138, 0.25)';
      p.fillRect(x, y, cw, ch);
    }
    p.drawImage(tileset.source, r.x, r.y, r.w, r.h, x, y, cw, ch);
  }
  palette.title = tileNames[selected - 1] ?? `tile ${selected - 1}`;
}
palette.addEventListener('click', (e) => {
  const r = palette.getBoundingClientRect();
  const sx = ((e.clientX - r.left) / r.width) * palette.width;
  const sy = ((e.clientY - r.top) / r.height) * palette.height;
  const i =
    Math.floor(sy / (tileset.tileHeight * PALETTE_SCALE)) * 4 +
    Math.floor(sx / (tileset.tileWidth * PALETTE_SCALE));
  if (i < tileset.tileCount) {
    selected = i + 1;
    if (tool === 'erase' || tool === 'pick') setTool('paint');
    drawPalette();
    updateStatus();
  }
});

// --- files -----------------------------------------------------------------

async function decompress(data: Uint8Array, format: 'zlib' | 'gzip'): Promise<Uint8Array> {
  // "deflate" in DecompressionStream is the zlib format Tiled writes.
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream(format === 'zlib' ? 'deflate' : 'gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function download(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#export').addEventListener('click', () => {
  const json = JSON.stringify(toTmj(map, tileset), null, 1);
  download('map.tmj', new Blob([json], { type: 'application/json' }));
});

$('#export-image').addEventListener('click', () => {
  // Tall tiles reach above the top row and past the right edge.
  const top = Math.max(0, tileset.tileHeight - map.tileHeight);
  const right = Math.max(0, tileset.tileWidth - map.tileWidth);
  const size = mapPixelSize(map);
  const image = document.createElement('canvas');
  image.width = size.x + right;
  image.height = size.y + top;
  render(image.getContext('2d')!, map, tileset, { x: 0, y: -top, zoom: 1 }, { grid: false });
  image.toBlob((blob) => blob && download('map.png', blob), 'image/png');
});

$('#export-tileset').addEventListener('click', () => {
  if (tileset.source === generated) {
    generated.toBlob((blob) => blob && download(tileset.image, blob), 'image/png');
  } else {
    showStatus('the tileset image is your own file, it is already on disk');
  }
});

$<HTMLInputElement>('#import').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])];
  (e.target as HTMLInputElement).value = '';
  const tmjFile = files.find((f) => /\.(tmj|tmx|json)$/i.test(f.name));
  if (!tmjFile) {
    return showStatus('pick a .tmj or .tmx file, and its tileset image if it is not isotiles.png');
  }
  try {
    const text = await tmjFile.text();
    const json = /\.tmx$/i.test(tmjFile.name) ? await tmxToTmj(text, decompress) : JSON.parse(text);
    const imported = fromTmj(json);
    const imageName = imported.tileset.image.split(/[\\/]/).pop()!;
    const imageFile = files.find((f) => f.name === imageName);
    let source: CanvasImageSource = generated;
    if (imageFile) {
      source = await createImageBitmap(imageFile);
      tileNames = [];
    } else if (imageName === GENERATED_TILESET.image) {
      tileNames = GENERATED_TILE_NAMES;
    } else {
      return showStatus(`also pick ${imageName}, the map uses it as its tileset image`);
    }
    map = imported.map;
    tileset = { ...imported.tileset, source };
    layer = 0;
    selected = 1;
    history.clear();
    refreshLayers();
    drawPalette();
    centerView();
    scheduleSave();
    showStatus(`opened ${tmjFile.name}`);
  } catch (err) {
    showStatus(err instanceof TmjError || err instanceof SyntaxError ? err.message : String(err));
  }
});

$('#new').addEventListener('click', () => {
  const w = Number($<HTMLInputElement>('#new-width').value);
  const h = Number($<HTMLInputElement>('#new-height').value);
  if (!(w >= 1 && w <= 256 && h >= 1 && h <= 256)) return showStatus('size must be 1 to 256');
  map = createMap(w, h, 64, 32);
  tileset = { ...GENERATED_TILESET, source: generated };
  tileNames = GENERATED_TILE_NAMES;
  layer = 0;
  history.clear();
  refreshLayers();
  drawPalette();
  centerView();
  scheduleSave();
});

// --- status and loop -------------------------------------------------------

let message = '';
let messageUntil = 0;
function showStatus(text: string): void {
  message = text;
  messageUntil = performance.now() + 4000;
  updateStatus();
}

function updateStatus(): void {
  if (performance.now() < messageUntil) {
    status.textContent = message;
    return;
  }
  const name = tileNames[selected - 1] ?? `tile ${selected - 1}`;
  const cell = hover ? `${hover.x}, ${hover.y}` : '-';
  status.textContent = `${map.width}x${map.height}   cell ${cell}   ${tool}   ${name}`;
}

function frame(): void {
  if (dirty) {
    dirty = false;
    render(ctx, map, tileset, view, {
      hover,
      rect,
      preview: tool === 'paint' ? selected : 0,
      previewLayer: layer,
      grid: gridToggle.checked,
    });
  }
  requestAnimationFrame(frame);
}

addEventListener('resize', resize);
resize();
centerView();
refreshLayers();
drawPalette();
setTool('paint');
updateStatus();
requestAnimationFrame(frame);
