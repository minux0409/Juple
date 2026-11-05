import { buildBlobPath, buildLayerPaths, frameFromPose, type BlobPose } from '../jellyBlobGeometry';

const rest: BlobPose = {
  left: 100,
  right: 192,
  restWidth: 92,
  restHalfHeight: 30,
  centerY: 40,
  pop: 0,
  leadsRight: true,
  maxExtraLength: 80,
};

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('liquid blob path', () => {
  it('is a closed smooth path of cubic segments only (no straight edges or corners)', () => {
    const d = buildBlobPath(frameFromPose(rest));
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(7);
    expect(d).not.toMatch(/[LHV]/);
  });

  it('is irregular at rest: not left-right or top-bottom symmetric', () => {
    const points = numbers(buildBlobPath(frameFromPose(rest)));
    const xs = points.filter((_, i) => i % 2 === 0);
    const ys = points.filter((_, i) => i % 2 === 1);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const above = ys.filter(y => y < 40).length;
    const below = ys.filter(y => y > 40).length;
    expect(above).not.toBe(below);
    expect(xs.filter(x => x < centerX).length).not.toBe(xs.filter(x => x > centerX).length);
  });

  it('changes its OUTLINE (not just its position) while it is stretched between two tabs', () => {
    const settled = buildBlobPath(frameFromPose(rest));
    // Moving right: the leading (right) edge is already at the destination, the trailing (left) edge has not moved.
    const stretched = buildBlobPath(frameFromPose({ ...rest, right: 192 + 70 }));
    const shape = (d: string) => {
      const n = numbers(d);
      const xs = n.filter((_, i) => i % 2 === 0);
      const ys = n.filter((_, i) => i % 2 === 1);
      const left = Math.min(...xs);
      // Normalised: width-independent outline.
      return n.map((v, i) => (i % 2 === 0 ? (v - left) / (Math.max(...xs) - left) : (v - Math.min(...ys)) / (Math.max(...ys) - Math.min(...ys))));
    };
    const a = shape(settled);
    const b = shape(stretched);
    const difference = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    // A translated or uniformly scaled shape would be identical here; a waist and a heavier head change it clearly.
    expect(difference).toBeGreaterThan(0.04);
  });

  it('thins as it lengthens (volume) and grows a waist and a heavier leading end', () => {
    const settled = frameFromPose(rest);
    const stretched = frameFromPose({ ...rest, right: 192 + 70 });
    expect(settled.pinch).toBe(0);
    expect(settled.bulge).toBe(0);
    expect(stretched.pinch).toBeGreaterThan(0.1);
    expect(stretched.bulge).toBeGreaterThan(0.05);
    expect(stretched.halfHeight).toBeLessThan(settled.halfHeight);
    expect(stretched.leadsRight).toBe(true);
  });

  it('never grows beyond its cap on a far jump - the trailing edge is dragged along', () => {
    const far = frameFromPose({ ...rest, right: 192 + 900 });
    expect(far.right - far.left).toBeCloseTo(rest.restWidth + rest.maxExtraLength, 5);
    expect(far.right).toBe(192 + 900);
    const farLeft = frameFromPose({ ...rest, leadsRight: false, left: 100 - 900 });
    expect(farLeft.right - farLeft.left).toBeCloseTo(rest.restWidth + rest.maxExtraLength, 5);
    expect(farLeft.left).toBe(100 - 900);
  });

  it('the landing pulse spreads it wider and fuller, pressed-in does the opposite', () => {
    const base = frameFromPose(rest);
    const spread = frameFromPose({ ...rest, pop: 1 });
    const pressed = frameFromPose({ ...rest, pop: -1 });
    expect(spread.right - spread.left).toBeGreaterThan(base.right - base.left);
    expect(spread.halfHeight).toBeGreaterThan(base.halfHeight);
    expect(pressed.right - pressed.left).toBeLessThan(base.right - base.left);
  });
});

describe('liquid surface layers', () => {
  const x = (d: string) => numbers(d).filter((_, i) => i % 2 === 0);

  it('derives every layer from the same pose: rim inside the body, reflection in the upper part', () => {
    const layers = buildLayerPaths(rest);
    expect(Math.min(...x(layers.rim))).toBeGreaterThan(Math.min(...x(layers.body)));
    expect(Math.max(...x(layers.rim))).toBeLessThan(Math.max(...x(layers.body)));
    const ys = (d: string) => numbers(d).filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys(layers.highlight))).toBeLessThan(rest.centerY);
    expect(layers.highlight.match(/C/g)).toHaveLength(2);
  });

  it('the reflection lengthens and slides away from the head while the drop stretches', () => {
    const settled = buildLayerPaths(rest);
    const stretched = buildLayerPaths({ ...rest, right: 192 + 70 });
    const length = (d: string) => Math.max(...x(d)) - Math.min(...x(d));
    expect(length(stretched.highlight)).toBeGreaterThan(length(settled.highlight));
    // Moving right, the reflection's right end lags behind the head (it is pushed toward the tail).
    expect(Math.max(...x(stretched.body)) - Math.max(...x(stretched.highlight))).toBeGreaterThan(
      Math.max(...x(settled.body)) - Math.max(...x(settled.highlight)),
    );
  });

  it('keeps all layers smooth (only M, C and Z commands) at every state', () => {
    for (const pose of [rest, { ...rest, right: 400 }, { ...rest, pop: 1 }, { ...rest, pop: -1 }, { ...rest, leadsRight: false, left: -200 }]) {
      const layers = buildLayerPaths(pose);
      for (const d of [layers.body, layers.rim, layers.highlight, layers.spot]) {
        expect(d).not.toMatch(/[LHVQSTA]/);
        expect(numbers(d).every(Number.isFinite)).toBe(true);
      }
    }
  });
});

describe('liquid against the bar edges', () => {
  it('is held inside the bar: a head that would leave the screen flattens against the wall', () => {
    const frame = frameFromPose({ ...rest, right: 500, minX: 3, maxX: 360 });
    expect(frame.right).toBeLessThanOrEqual(360);
    const left = frameFromPose({ ...rest, leadsRight: false, left: -80, minX: 3, maxX: 360 });
    expect(left.left).toBeGreaterThanOrEqual(3);
    expect(left.right).toBeGreaterThan(left.left);
  });
});
