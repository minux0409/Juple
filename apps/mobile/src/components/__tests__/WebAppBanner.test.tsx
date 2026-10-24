import ReactTestRenderer, { act } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { WebAppBanner } from '../WebAppBanner';
import i18n from '../../i18n';

it('introduces the web app without a CTA, link or press handler', async () => {
  await i18n.changeLanguage('ko');
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<WebAppBanner />); });
  const text = renderer.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain('Juple은 웹에서도 이용할 수 있어요');
  expect(text).toContain('PC에서 juple.co.kr에 접속해 저장한 링크와 컬렉션을 관리해 보세요.');
  expect(text).toContain('juple.co.kr');
  expect(renderer.root.findAllByType(Pressable)).toHaveLength(0);
  expect(renderer.root.findAll(node => typeof node.props.onPress === 'function')).toHaveLength(0);
  await act(async () => renderer.unmount());
});
