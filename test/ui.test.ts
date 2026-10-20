// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMap, setTile } from '../src/map.js';
import { GENERATED_TILESET } from '../src/tileset.js';
import { toTmj } from '../src/tmj.js';

// Runs the real editor page. happy-dom has no 2D canvas or layout, so the
// context is a stub that accepts every call and every element is 800x600.
const stubContext = (canvas: HTMLCanvasElement): unknown => {
  const target = () => proxy;
  const proxy: unknown = new Proxy(target, {
    get: (_, key) => (key === 'canvas' ? canvas : proxy),
    set: () => true,
    apply: () => proxy,
  });
  return proxy;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const pointer = (type: string, x: number, y: number) =>
  new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true });

function saved(): number[][] {
  const tmj = JSON.parse(localStorage.getItem('isotiles.map')!) as { layers: { data: number[] }[] };
  return tmj.layers.map((l) => l.data);
}

async function openFile(name: string, text: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#import')!;
  Object.defineProperty(input, 'files', { value: [new File([text], name)], configurable: true });
  input.dispatchEvent(new Event('change'));
  await wait(50);
}

/** Clicks tile `index` in the palette, 4 columns at 0.75 scale. */
function clickPalette(index: number, tileWidth: number, tileHeight: number): void {
  const palette = document.querySelector<HTMLCanvasElement>('#palette')!;
  const x = ((index % 4) + 0.5) * tileWidth * 0.75;
  const y = (Math.floor(index / 4) + 0.5) * tileHeight * 0.75;
  palette.dispatchEvent(
    new MouseEvent('click', {
      clientX: (x / palette.width) * 800,
      clientY: (y / palette.height) * 600,
    }),
  );
}

/** Paints one cell near the middle of the view with the current tool. */
function paintCenter(): void {
  const view = document.querySelector<HTMLCanvasElement>('#view')!;
  view.dispatchEvent(pointer('pointerdown', 400, 300));
  view.dispatchEvent(pointer('pointerup', 400, 300));
}

beforeAll(async () => {
  const html = readFileSync('public/index.html', 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    return stubContext(this);
  } as never;
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0 }) as DOMRect;
  window.requestAnimationFrame = () => 0;
  globalThis.Option = function (text: string, value: string, _: boolean, selected: boolean) {
    const option = document.createElement('option');
    Object.assign(option, { text, value, selected });
    return option;
  } as never;
  localStorage.clear();
  await import('../src/main.js');
});

describe('editor page', () => {
  it('New selects a built in tile again after a bigger imported tileset', async () => {
    const big = { ...GENERATED_TILESET, tileCount: 32 };
    const map = createMap(2, 1);
    setTile(map, 0, 0, 0, 30);
    await openFile('big.tmj', JSON.stringify(toTmj(map, big)));
    clickPalette(29, big.tileWidth, big.tileHeight);

    document.querySelector<HTMLButtonElement>('#new')!.click();
    paintCenter();
    await wait(600);

    const ground = saved()[0]!;
    expect(ground).not.toContain(30);
    expect(ground).toContain(1);
  });
});
