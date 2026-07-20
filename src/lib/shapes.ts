export type PixelShape = "square" | "circle" | "pentagon";

type Pt = [number, number];

export interface ShapeDef {
  label: string;
  /**
   * Polygon glyph vertices in cell-local units for cell (i, j); may extend
   * past the cell rect. Present only for polygon glyphs whose footprint
   * differs from the plain cell (used for exact click hit-testing).
   */
  verts?: (i: number, j: number) => Pt[];
  /** Build the glyph outline path for the cell rect (x, y, w, h). */
  trace: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    i: number,
    j: number,
  ) => void;
  /** Fill one cell glyph. fillStyle is preset by the caller. */
  draw: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    i: number,
    j: number,
  ) => void;
}

/**
 * Cairo pentagonal tiling, equilateral member, mapped 1:1 onto the square
 * grid: one pentagon per cell in four orientations arranged in a 2×2
 * pinwheel (period 2 in both axes). With p = √7/(1+√7), q = 1−p every
 * pentagon has area exactly one cell and the plane is tiled with no gaps
 * or overlaps (verified numerically). 4-fold "pinwheel" vertices sit on
 * cell corners with even i+j parity.
 */
const CP = Math.sqrt(7) / (1 + Math.sqrt(7));
const CQ = 1 - CP;

const CAIRO: [Pt[], Pt[], Pt[], Pt[]] = [
  // i even, j even
  [
    [0, 0],
    [CP, CQ],
    [1, 1],
    [CQ, 2 - CP],
    [-CQ, CP],
  ],
  // i even, j odd
  [
    [1, 0],
    [1 - CQ, CP],
    [0, 1],
    [CP - 1, CQ],
    [1 - CP, -CQ],
  ],
  // i odd, j even
  [
    [0, 1],
    [CQ, 1 - CP],
    [1, 0],
    [2 - CP, 1 - CQ],
    [CP, 1 + CQ],
  ],
  // i odd, j odd
  [
    [1, 1],
    [1 - CP, 1 - CQ],
    [0, 0],
    [1 - CQ, CP - 1],
    [1 + CQ, 1 - CP],
  ],
];

function cairoVerts(i: number, j: number): Pt[] {
  return CAIRO[(i % 2) * 2 + (j % 2)];
}

function tracePoly(
  ctx: CanvasRenderingContext2D,
  verts: Pt[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + verts[0][0] * w, y + verts[0][1] * h);
  for (let n = 1; n < verts.length; n++) {
    ctx.lineTo(x + verts[n][0] * w, y + verts[n][1] * h);
  }
  ctx.closePath();
}

/** Standard ray-cast point-in-polygon, in cell-local units. */
export function pointInVerts(px: number, py: number, verts: Pt[]): boolean {
  let inside = false;
  for (let a = 0, b = verts.length - 1; a < verts.length; b = a++) {
    const [x1, y1] = verts[a];
    const [x2, y2] = verts[b];
    if (y1 > py !== y2 > py && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Pixel glyph registry. `draw` fills the glyph, `trace` builds its outline
 * (used for the selected-pixel highlight). Adding a shape = one entry here.
 */
export const SHAPES: Record<PixelShape, ShapeDef> = {
  square: {
    label: "Squares",
    trace: (ctx, x, y, w, h) => {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
    },
    draw: (ctx, x, y, w, h) => {
      ctx.fillRect(x, y, w, h);
    },
  },
  circle: {
    label: "Circles",
    trace: (ctx, x, y, w, h) => {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    },
    draw: (ctx, x, y, w, h) => {
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  pentagon: {
    label: "Cairo pentagons",
    verts: cairoVerts,
    trace: (ctx, x, y, w, h, i, j) => {
      tracePoly(ctx, cairoVerts(i, j), x, y, w, h);
    },
    draw: (ctx, x, y, w, h, i, j) => {
      tracePoly(ctx, cairoVerts(i, j), x, y, w, h);
      ctx.fill();
      // Hairline stroke in the fill color seals sub-pixel seams between
      // pentagons caused by rounded cell edges.
      ctx.strokeStyle = ctx.fillStyle as string;
      ctx.lineWidth = 1;
      ctx.stroke();
    },
  },
};

export const SHAPE_OPTIONS = (Object.keys(SHAPES) as PixelShape[]).map((key) => ({
  key,
  label: SHAPES[key].label,
}));

/** Below this cell size (px) non-square glyphs are indistinguishable — draw
 *  plain rects instead, which is much faster for large grids. */
export const SHAPE_MIN_PX = 4;
