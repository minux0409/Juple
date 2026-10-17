import { CROP_OUTPUT_MAX, MAX_ZOOM, MIN_ZOOM, clampView, coverScale, cropRect, initialView, outputSide, panBy, zoomTo } from '../cropMath';

const V = 300;

describe('cropMath', () => {
  it('zoom 1 covers the square with the shorter side, centred; the crop is the centred 1:1 square', () => {
    expect(initialView(4000, 3000, V).zoom).toBe(MIN_ZOOM);
    expect(cropRect(initialView(4000, 3000, V), 4000, 3000, V)).toEqual({ x: 500, y: 0, size: 3000 });
    expect(cropRect(initialView(1000, 2000, V), 1000, 2000, V)).toEqual({ x: 0, y: 500, size: 1000 });
    expect(cropRect(initialView(800, 800, V), 800, 800, V)).toEqual({ x: 0, y: 0, size: 800 });
  });

  it('panning never leaves the photo, at any zoom', () => {
    const zoomed = zoomTo(initialView(4000, 3000, V), 2, 4000, 3000, V);
    for (const [dx, dy] of [[9999, 9999], [-9999, -9999], [9999, -9999]]) {
      const rect = cropRect(panBy(zoomed, dx, dy, 4000, 3000, V), 4000, 3000, V);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.size).toBeLessThanOrEqual(4000);
      expect(rect.y + rect.size).toBeLessThanOrEqual(3000);
    }
    expect(panBy(initialView(4000, 3000, V), 0, 400, 4000, 3000, V).y).toBe(0);
  });

  it('zoom is bounded both ways, keeps the point under the focus, and a higher zoom crops a smaller square', () => {
    const start = initialView(2000, 2000, V);
    expect(zoomTo(start, 0.1, 2000, 2000, V).zoom).toBe(MIN_ZOOM);
    expect(zoomTo(start, 50, 2000, 2000, V).zoom).toBe(MAX_ZOOM);
    expect(clampView({ zoom: Number.NaN, x: 0, y: 0 }, 2000, 2000, V).zoom).toBe(MIN_ZOOM);
    const focus = { x: 80, y: 40 };
    const zoomed = zoomTo(start, 2, 2000, 2000, V, focus);
    const base = coverScale(2000, 2000, V);
    expect(Math.abs((focus.x - start.x) / base - (focus.x - zoomed.x) / (base * 2))).toBeLessThan(1e-6);
    expect(cropRect(zoomed, 2000, 2000, V).size).toBeLessThan(cropRect(start, 2000, 2000, V).size);
  });

  it('exports at most what the server keeps, never enlarged', () => {
    expect(CROP_OUTPUT_MAX).toBe(512);
    expect(outputSide(1600)).toBe(512);
    expect(outputSide(300)).toBe(300);
  });
});
