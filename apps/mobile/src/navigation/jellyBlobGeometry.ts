/**
 * The selected tab's liquid blob as a PATH WHOSE CONTROL POINTS MOVE, not a fixed shape that is translated.
 *
 * One irregular, asymmetric base outline (in the 100x60-ish box it was drawn in) is kept as a list of Bezier points. For every frame the
 * outline is rebuilt from the blob's live state:
 *  - `left` / `right`: the two edges, each driven by its own spring (the leading edge races ahead, the trailing edge is dragged along),
 *    so the blob really is longer while it travels;
 *  - `pinch`: the waist - the middle of a stretched drop gets thinner than its ends (a thread of liquid between two bulbs);
 *  - `bulge` with `leadsRight`: the leading end is rounder and heavier than the tail, so the stretched shape is lopsided;
 *  - `halfHeight`: the vertical extent, which shrinks as the blob lengthens (the volume has to go somewhere) and pulses on landing.
 * Every point is mapped through these, so the outline keeps smooth curves (no new corners) at any state and, at rest
 * (pinch 0, bulge 0), is exactly the irregular base blob.
 */

/** [x, y] points of the base outline: the start point, then 7 cubic segments of (control 1, control 2, end). */
const BASE_POINTS: readonly (readonly [number, number])[] = [
  [9, 25],
  [7, 13], [21, 5], [37, 7],
  [49, 8.5], [56, 2.5], [70, 5],
  [88, 8], [98, 19], [95.5, 32],
  [94, 43], [99, 51], [85, 55.5],
  [72, 59.5], [61, 54], [47, 57],
  [31, 60], [17, 58.5], [9.5, 49],
  [4, 42], [11, 36.5], [9, 25],
];

const BASE_X0 = 9;
const BASE_X1 = 95.5;
const BASE_CY = 31;
const BASE_HALF_HEIGHT = 26;

export interface BlobFrame {
  readonly left: number;
  readonly right: number;
  /** Vertical centre line. */
  readonly centerY: number;
  readonly halfHeight: number;
  /** 0 = no waist; ~0.35 = a clearly thinner middle. */
  readonly pinch: number;
  /** 0 = both ends alike; > 0 = the leading end heavier than the tail. */
  readonly bulge: number;
  /** Which end leads (the one nearer the destination). */
  readonly leadsRight: boolean;
}

const f = (value: number) => Math.round(value * 100) / 100;

/** The vertical scale at horizontal position u (0 = left end .. 1 = right end): waist in the middle, heavier leading end. */
function verticalFactor(u: number, frame: BlobFrame): number {
  const waist = 1 - frame.pinch * Math.exp(-(((u - 0.5) / 0.2) ** 2));
  const towardLead = frame.leadsRight ? u : 1 - u;
  return waist * (1 + frame.bulge * (2 * towardLead - 1));
}

/** The SVG path `d` of the blob in this state. */
export function buildBlobPath(frame: BlobFrame): string {
  const width = frame.right - frame.left;
  const points = BASE_POINTS.map(([bx, by]) => {
    const u = (bx - BASE_X0) / (BASE_X1 - BASE_X0);
    const x = frame.left + u * width;
    const y = frame.centerY + ((by - BASE_CY) / BASE_HALF_HEIGHT) * frame.halfHeight * verticalFactor(Math.min(1, Math.max(0, u)), frame);
    return [f(x), f(y)] as const;
  });
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i += 3) {
    const [c1, c2, end] = [points[i], points[i + 1], points[i + 2]];
    d += ` C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${end[0]} ${end[1]}`;
  }
  return `${d} Z`;
}

export interface BlobPose {
  /** Edges as the two springs report them. */
  readonly left: number;
  readonly right: number;
  /** Resting rect of the destination: how long / tall the blob is when settled. */
  readonly restWidth: number;
  readonly restHalfHeight: number;
  readonly centerY: number;
  /** Landing pulse: -1 pressed in .. +1 spread out (it wobbles through 0 after the landing). */
  readonly pop: number;
  readonly leadsRight: boolean;
  /** The most a stretched blob may exceed its rest length - far jumps must not become a long bar. */
  readonly maxExtraLength: number;
  /** The bar's edges: the liquid is held inside them (it flattens against the wall instead of flying off the screen). */
  readonly minX?: number;
  readonly maxX?: number;
}

/** Turns the two spring edges and the landing pulse into a drawable frame: clamps the length and derives waist, heavy end and thickness. */
export function frameFromPose(pose: BlobPose): BlobFrame {
  const maxLength = pose.restWidth + pose.maxExtraLength;
  let { left, right } = pose;
  if (right - left > maxLength) {
    // The trailing edge is dragged along instead of letting the blob grow without bound.
    if (pose.leadsRight) {
      left = right - maxLength;
    } else {
      right = left + maxLength;
    }
  }
  if (pose.minX !== undefined) {
    left = Math.max(left, pose.minX);
  }
  if (pose.maxX !== undefined) {
    right = Math.min(right, pose.maxX);
  }
  // Squashed against a wall it still keeps a body: the end away from the wall gives way.
  const minWidth = pose.restWidth * 0.6;
  if (right - left < minWidth) {
    if (pose.leadsRight) {
      left = right - minWidth;
    } else {
      right = left + minWidth;
    }
  }
  const stretch = Math.min(1.6, Math.max(0, (right - left) / pose.restWidth - 1));
  // Landing pulse: spreads (wider and a little fuller) and then contracts; pressed-in is the opposite.
  const spread = pose.pop * 0.08;
  const center = (left + right) / 2;
  const half = ((right - left) / 2) * (1 + spread);
  return {
    left: center - half,
    right: center + half,
    centerY: pose.centerY,
    // Volume: the longer it gets, the thinner it is; a spread pulse also fattens it a little.
    halfHeight: pose.restHalfHeight * (1 - 0.2 * Math.min(1, stretch)) * (1 + pose.pop * 0.1),
    pinch: Math.min(0.42, 0.3 * stretch),
    bulge: Math.min(0.2, 0.14 * stretch),
    leadsRight: pose.leadsRight,
  };
}

/** A thin asymmetric lens (fat on the left, tapering to the right) - the shape of a window's reflection on a curved surface. */
export function buildLensPath(left: number, right: number, centerY: number, halfHeight: number): string {
  const w = right - left;
  const p = (x: number, y: number) => `${f(x)} ${f(y)}`;
  return (
    `M ${p(left, centerY)} ` +
    `C ${p(left + 0.18 * w, centerY - 1.5 * halfHeight)}, ${p(right - 0.3 * w, centerY - 1.25 * halfHeight)}, ${p(right, centerY + 0.15 * halfHeight)} ` +
    `C ${p(right - 0.32 * w, centerY - 0.1 * halfHeight)}, ${p(left + 0.32 * w, centerY + 0.4 * halfHeight)}, ${p(left, centerY)} Z`
  );
}

export interface BlobLayerPaths {
  /** The silhouette (the glow strokes and every colour layer reuse it). */
  readonly body: string;
  /** The silhouette pulled in a few dp: a thin inner rim of light that follows the outline as it deforms. */
  readonly rim: string;
  /** The window reflection on the upper part; it lengthens with the stretch and slides toward the trailing side. */
  readonly highlight: string;
  /** A small second glint near the head. */
  readonly spot: string;
}

/**
 * Every layer of the liquid from ONE pose, so the surface answers the deformation: when the outline stretches the reflection stretches,
 * thins and slides, the inner rim follows the narrowing waist, and on the landing pulse everything swells together.
 */
export function buildLayerPaths(pose: BlobPose): BlobLayerPaths {
  const frame = frameFromPose(pose);
  const width = frame.right - frame.left;
  const stretch = Math.min(1.6, Math.max(0, width / pose.restWidth - 1));
  const lead = frame.leadsRight ? 1 : -1;
  const inset = Math.min(3.2, frame.halfHeight * 0.14);
  const rim = buildBlobPath({
    ...frame,
    left: frame.left + inset * 1.4,
    right: frame.right - inset * 1.4,
    halfHeight: frame.halfHeight - inset,
  });
  // The reflection: starts ~15% in from the left, ends ~35% before the right; thinner as the drop thins; shifted away from the head.
  const shift = -lead * 0.1 * width * Math.min(1, stretch);
  const hlLeft = frame.left + width * 0.15 + shift;
  const hlRight = frame.right - width * 0.34 + shift;
  const thin = 1 - 0.35 * Math.min(1, stretch);
  const highlight = buildLensPath(hlLeft, Math.max(hlLeft + 6, hlRight), frame.centerY - frame.halfHeight * 0.42, frame.halfHeight * 0.2 * thin);
  const spotCenter = frame.right - width * 0.13;
  const spot = buildLensPath(spotCenter - width * 0.05, spotCenter + width * 0.05, frame.centerY - frame.halfHeight * 0.5, frame.halfHeight * 0.1);
  return { body: buildBlobPath(frame), rim, highlight, spot };
}
