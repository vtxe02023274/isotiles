/**
 * A tileset is one image cut into equal tiles, like a Tiled tileset with a
 * single image. Tiles may be taller than the map grid; they are drawn with
 * their bottom on the bottom vertex of the cell.
 */
export interface TilesetInfo {
  name: string;
  /** File name written into exported maps. */
  image: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  tileCount: number;
  /** Tiled's tileoffset: shifts every tile of the set when drawn. */
  offsetX?: number;
  offsetY?: number;
}

export interface Tileset extends TilesetInfo {
  source: CanvasImageSource;
}

export function tileRect(t: TilesetInfo, index: number) {
  return {
    x: (index % t.columns) * t.tileWidth,
    y: Math.floor(index / t.columns) * t.tileHeight,
    w: t.tileWidth,
    h: t.tileHeight,
  };
}

interface Ground {
  name: string;
  top: string;
  speckle?: string;
}

interface Block {
  name: string;
  top: string;
  left: string;
  right: string;
  height: number;
}

const GROUNDS: Ground[] = [
  { name: 'grass', top: '#6fa64a', speckle: '#87bd5c' },
  { name: 'dirt', top: '#9a6b43', speckle: '#ad7d52' },
  { name: 'sand', top: '#d9c27a', speckle: '#e6d394' },
  { name: 'water', top: '#3f7cc4', speckle: '#69a0de' },
  { name: 'stone', top: '#8a8f99', speckle: '#a3a8b2' },
  { name: 'snow', top: '#e8eef5', speckle: '#ffffff' },
  { name: 'lava', top: '#d2512a', speckle: '#f2a33a' },
  { name: 'planks', top: '#b0814e' },
];

const BLOCKS: Block[] = [
  { name: 'stone block', top: '#a3a8b2', left: '#7c818b', right: '#666a73', height: 32 },
  { name: 'brick wall', top: '#c26b4f', left: '#9b5039', right: '#80412f', height: 48 },
  { name: 'wood crate', top: '#c79a5b', left: '#a37a43', right: '#876436', height: 24 },
  { name: 'hedge', top: '#5d9440', left: '#477532', right: '#3a612a', height: 24 },
];

/** Names of the generated tiles, by tile index. */
export const GENERATED_TILE_NAMES = [
  ...GROUNDS.map((g) => g.name),
  ...BLOCKS.map((b) => b.name),
  'tree',
  'rock',
  'flowers',
  'lamp post',
];

export const GENERATED_TILESET: TilesetInfo = {
  name: 'isotiles',
  image: 'isotiles.png',
  tileWidth: 64,
  tileHeight: 96,
  columns: 8,
  tileCount: GENERATED_TILE_NAMES.length,
};

/**
 * Draws the built in tileset: flat ground diamonds, blocks and a few props.
 * Everything is drawn in code so the project ships no third party art.
 */
export function drawGeneratedTileset(canvas: HTMLCanvasElement | OffscreenCanvas): void {
  const t = GENERATED_TILESET;
  canvas.width = t.columns * t.tileWidth;
  canvas.height = Math.ceil(t.tileCount / t.columns) * t.tileHeight;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = t.tileWidth;
  const half = w / 2;
  const q = w / 4;
  let index = 0;

  const at = (fn: (ox: number, base: number) => void) => {
    const r = tileRect(t, index++);
    ctx.save();
    fn(r.x, r.y + r.h);
    ctx.restore();
  };

  // Diamond whose bottom vertex is at (ox + half, base).
  const diamond = (ox: number, base: number, lift = 0) => {
    ctx.beginPath();
    ctx.moveTo(ox + half, base - 2 * q - lift);
    ctx.lineTo(ox + w, base - q - lift);
    ctx.lineTo(ox + half, base - lift);
    ctx.lineTo(ox, base - q - lift);
    ctx.closePath();
  };

  for (const g of GROUNDS) {
    at((ox, base) => {
      diamond(ox, base);
      ctx.fillStyle = g.top;
      ctx.fill();
      if (g.speckle) {
        ctx.clip();
        ctx.fillStyle = g.speckle;
        for (let i = 0; i < 14; i++) {
          // Fixed pattern so the image is the same on every run.
          const x = ox + ((i * 37) % w);
          const y = base - 2 * q + ((i * 13) % (2 * q));
          ctx.fillRect(x, y, 2, 2);
        }
      }
      if (g.name === 'planks') {
        ctx.strokeStyle = '#8c6438';
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(ox + (i * half) / 4, base - q - (i * q) / 4);
          ctx.lineTo(ox + half + (i * half) / 4, base - (i * q) / 4);
          ctx.stroke();
        }
      }
    });
  }

  for (const b of BLOCKS) {
    at((ox, base) => {
      const h = b.height;
      ctx.fillStyle = b.left;
      ctx.beginPath();
      ctx.moveTo(ox, base - q);
      ctx.lineTo(ox + half, base);
      ctx.lineTo(ox + half, base - h);
      ctx.lineTo(ox, base - q - h);
      ctx.fill();
      ctx.fillStyle = b.right;
      ctx.beginPath();
      ctx.moveTo(ox + half, base);
      ctx.lineTo(ox + w, base - q);
      ctx.lineTo(ox + w, base - q - h);
      ctx.lineTo(ox + half, base - h);
      ctx.fill();
      diamond(ox, base, h);
      ctx.fillStyle = b.top;
      ctx.fill();
    });
  }

  // Tree
  at((ox, base) => {
    ctx.fillStyle = '#6b4a2b';
    ctx.fillRect(ox + half - 4, base - q - 30, 8, 30);
    ctx.fillStyle = '#3f7a35';
    ctx.beginPath();
    ctx.arc(ox + half, base - q - 44, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4f9142';
    ctx.beginPath();
    ctx.arc(ox + half - 6, base - q - 50, 12, 0, Math.PI * 2);
    ctx.fill();
  });

  // Rock
  at((ox, base) => {
    ctx.fillStyle = '#7c818b';
    ctx.beginPath();
    ctx.ellipse(ox + half, base - q - 4, 18, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#9aa0aa';
    ctx.beginPath();
    ctx.ellipse(ox + half - 4, base - q - 8, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  });

  // Flowers
  at((ox, base) => {
    const colors = ['#e85d75', '#f2c14e', '#ffffff', '#b07ce8'];
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = colors[i % colors.length]!;
      const x = ox + half - 14 + ((i * 11) % 28);
      const y = base - q - 6 + ((i * 7) % 10) - 5;
      ctx.fillRect(x, y, 3, 3);
    }
  });

  // Lamp post
  at((ox, base) => {
    ctx.fillStyle = '#3b3f47';
    ctx.fillRect(ox + half - 2, base - q - 60, 4, 60);
    ctx.fillStyle = '#ffe08a';
    ctx.fillRect(ox + half - 6, base - q - 70, 12, 10);
  });
}
