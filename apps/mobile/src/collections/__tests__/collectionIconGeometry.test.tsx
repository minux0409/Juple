import ReactTestRenderer, { act } from 'react-test-renderer';
import { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { COLLECTION_ICON_KEYS, resolveCollectionIconComponent } from '../collectionIcons';

// Node's own fs - this app ships no Node type definitions, so only what is used is typed here.
const { readFileSync, writeFileSync } = require('fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  writeFileSync: (path: string, data: string, encoding: 'utf8') => void;
};
declare const __dirname: string;
declare const process: { env: Record<string, string | undefined> };

/**
 * The glyph of every Collection icon, as plain SVG primitives, for the Android Home-screen shortcut and Direct Share icon
 * (CollectionShortcutIcon.kt draws them natively). It is GENERATED from the very components the Collection cards render - there
 * is no second hand-kept icon table: this test rebuilds the geometry from the live components and fails when the committed
 * asset differs. After changing or adding an icon:  UPDATE_ICON_GEOMETRY=1 npx jest collectionIconGeometry
 */
const ASSET = `${__dirname}/../../../android/app/src/main/assets/collection_icon_geometry.json`;
const MARK = '#0A0B0C';

interface Primitive {
  readonly t: 'path' | 'circle' | 'ellipse' | 'rect' | 'line' | 'polygon' | 'polyline';
  readonly [attribute: string]: string | number | boolean;
}

const TYPES: ReadonlyArray<readonly [unknown, Primitive['t'], readonly string[]]> = [
  [Path, 'path', ['d']],
  [Circle, 'circle', ['cx', 'cy', 'r']],
  [Ellipse, 'ellipse', ['cx', 'cy', 'rx', 'ry']],
  [Rect, 'rect', ['x', 'y', 'width', 'height', 'rx']],
  [Line, 'line', ['x1', 'y1', 'x2', 'y2']],
  [Polygon, 'polygon', ['points']],
  [Polyline, 'polyline', ['points']],
];

const num = (value: unknown): number | string => (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value)) ? Number(value) : (value as number | string));

function geometryOf(key: string): Primitive[] {
  const Icon = resolveCollectionIconComponent(key);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<Icon color={MARK} size={24} />);
  });
  const found = renderer.root.findAll(node => TYPES.some(([type]) => node.type === type));
  return found.map(node => {
    const [, t, attributes] = TYPES.find(([type]) => node.type === type)!;
    const props = node.props as Record<string, unknown>;
    const primitive: Record<string, string | number | boolean> = { t };
    for (const attribute of attributes) {
      if (props[attribute] !== undefined) {
        primitive[attribute] = num(props[attribute]) as string | number;
      }
    }
    const stroked = props.stroke === MARK;
    const filled = props.fill === MARK;
    if (stroked) {
      primitive.stroke = true;
      primitive.sw = num(props.strokeWidth ?? 1) as number;
      primitive.cap = (props.strokeLinecap as string | undefined) ?? 'butt';
      primitive.join = (props.strokeLinejoin as string | undefined) ?? 'miter';
    }
    if (filled) {
      primitive.fill = true;
    }
    return primitive as Primitive;
  });
}

function currentGeometry(): Record<string, Primitive[]> {
  return Object.fromEntries(COLLECTION_ICON_KEYS.map(key => [key, geometryOf(key)]));
}

describe('Collection icon geometry for the Android shortcut icon', () => {
  it('every icon yields at least one drawable primitive, all of them either stroked or filled in the glyph color', () => {
    const geometry = currentGeometry();
    for (const key of COLLECTION_ICON_KEYS) {
      expect(geometry[key].length).toBeGreaterThan(0);
      for (const primitive of geometry[key]) {
        expect(primitive.stroke === true || primitive.fill === true).toBe(true);
      }
    }
  });

  it('the committed android asset is exactly what the live icon components draw (no second, drifting icon table)', () => {
    const expected = `${JSON.stringify(currentGeometry(), null, 1)}\n`;
    if (process.env.UPDATE_ICON_GEOMETRY === '1') {
      writeFileSync(ASSET, expected, 'utf8');
    }
    expect(readFileSync(ASSET, 'utf8').replace(/\r\n/g, '\n')).toBe(expected);
  });
});
