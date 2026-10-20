// Renders the toolbar icon (rounded square with three rising bars, the last
// one red) as a PNG, so the repo needs no binary assets or image tooling.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

type RGB = readonly [number, number, number];

const BG: RGB = [15, 20, 25];
const BAR: RGB = [231, 233, 234];
const HOT: RGB = [244, 33, 46];

// Coordinates are fractions of the icon size, origin top-left.
//
// Three columns of equal width, separated by GAP: a short red bar, a taller
// white bar, and a tall hollow slab whose top and bottom are cut on a
// slope. A thin horizontal band crosses the slab, kept only as a short STUB on each
// side, ending CUT short of the white bar. The group is centred.
const COLUMN = 0.14;
const GAP = 0.045;
const CUT = 0.014;
const STUB = GAP - CUT;

const SLAB_HEIGHT = 0.707; // length of each vertical edge
const SLAB_SLOPE = 0.69; // drop of the top and bottom cuts per unit of width
const SLAB_LINE = 0.038; // outline thickness, measured square to each edge

const BAND_OFFSET = 0.395; // band centre below the slab's top-left corner
const BAND_THICKNESS = 0.04;

const TOP = (1 - (SLAB_HEIGHT + COLUMN * SLAB_SLOPE)) / 2;
const LEFT = (1 - (3 * COLUMN + 2 * GAP + STUB)) / 2;
const SLAB_LEFT = LEFT + 2 * (COLUMN + GAP);
const SLAB_RIGHT = SLAB_LEFT + COLUMN;
const BASELINE = TOP + SLAB_HEIGHT;

/** Inside the slab shrunk by `inset` on every side. */
function inSlab(x: number, y: number, inset: number): boolean {
  if (x < SLAB_LEFT + inset || x >= SLAB_RIGHT - inset) return false;
  const top = TOP + (x - SLAB_LEFT) * SLAB_SLOPE;
  // A sloped edge moved `inset` square to itself moves this far vertically.
  const vertical = inset * Math.hypot(1, SLAB_SLOPE);
  return y >= top + vertical && y < top + SLAB_HEIGHT - vertical;
}

function inStub(x: number, y: number): boolean {
  const onLeft = x >= SLAB_LEFT - STUB && x < SLAB_LEFT;
  const onRight = x >= SLAB_RIGHT && x < SLAB_RIGHT + STUB;
  if (!onLeft && !onRight) return false;
  return Math.abs(y - (TOP + BAND_OFFSET)) <= BAND_THICKNESS / 2;
}

// Rising bars with square ends, ending level with the slab's left edge.
const BARS = [
  { x0: LEFT, top: 0.56, color: HOT },
  { x0: LEFT + COLUMN + GAP, top: 0.34, color: BAR },
].map((b) => ({ ...b, x1: b.x0 + COLUMN, bottom: BASELINE }));

function pixel(x: number, y: number): RGB | null {
  // Rounded-square mask.
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;

  for (const b of BARS) {
    if (x >= b.x0 && x < b.x1 && y >= b.top && y < b.bottom) return b.color;
  }
  if (inSlab(x, y, 0)) return inSlab(x, y, SLAB_LINE) ? BG : BAR;
  return inStub(x, y) ? BAR : BG;
}

/**
 * `padding` is transparent space on each side, in pixels. The Chrome Web
 * Store wants the 128px icon as 96px of artwork with 16px padding.
 */
export function renderIcon(size: number, padding = 0): Buffer {
  const ss = 4; // supersampling for anti-aliased edges
  const art = size - 2 * padding;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = pixel((x - padding + (sx + 0.5) / ss) / art, (y - padding + (sy + 0.5) / ss) / art);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
