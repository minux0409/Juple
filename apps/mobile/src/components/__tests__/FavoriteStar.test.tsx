import React from 'react';
import { Animated } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FavoriteStar } from '../FavoriteStar';

const star = (active: boolean, playToken = 0) => <FavoriteStar active={active} playToken={playToken} size={20} testID="star" />;
const mount = async (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(element); });
  return renderer;
};
const update = async (renderer: ReactTestRenderer.ReactTestRenderer, element: React.ReactElement) => { await act(async () => { renderer.update(element); }); };

describe('FavoriteStar', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('renders 8 real particles (dots and rays) around the star, on a zero-size overflow-visible overlay', async () => {
    const renderer = await mount(star(false));
    const overlay = renderer.root.findAll(node => node.props.testID === 'star-burst' && typeof node.type === 'string')[0];
    expect(overlay.props.pointerEvents).toBe('none');
    expect(overlay.children).toHaveLength(8);
  });

  it('plays nothing on first render, on a state change without a tap (rollback, list re-render, bulk action)', async () => {
    const parallel = jest.spyOn(Animated, 'parallel');
    const renderer = await mount(star(true));
    await update(renderer, star(false));
    await update(renderer, star(true));
    expect(parallel).not.toHaveBeenCalled();
  });

  it('plays the ON and then the OFF effect only for a tapped change, and a failed request that flips back plays nothing', async () => {
    const parallel = jest.spyOn(Animated, 'parallel');
    const renderer = await mount(star(false));
    await update(renderer, star(true, 1)); // tap -> optimistic ON
    expect(parallel).toHaveBeenCalledTimes(1);
    await update(renderer, star(false, 1)); // server refused -> rollback, no new tap
    expect(parallel).toHaveBeenCalledTimes(1);
    await update(renderer, star(true, 2));
    await update(renderer, star(false, 3)); // rapid second tap restarts cleanly
    expect(parallel).toHaveBeenCalledTimes(3);
  });
});
