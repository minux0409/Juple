import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image } from 'react-native';
import i18n from '../../i18n';
import { GlobeIcon } from '../../icons/GlobeIcon';
import { PendingSubmissionCard, type PendingSubmissionRow } from '../PendingSubmissionCard';

// oe 60000000 = 2021-01-14 (long past), F0000000 = 2097-08-05 (far future): no clock control needed.
const EXPIRED = 'https://scontent-ssn1-1.cdninstagram.com/v/p.jpg?oh=00_sig&oe=60000000';
const VALID = 'https://scontent-ssn1-1.cdninstagram.com/v/p.jpg?oh=00_sig&oe=F0000000';

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

function renderCard(previewImageUrl: string | null) {
  const row: PendingSubmissionRow = {
    submissionId: 9,
    url: 'https://www.instagram.com/p/abc/',
    title: 'Proposed link',
    previewImageUrl,
    submittedAtUtc: new Date().toISOString(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<PendingSubmissionCard row={row} variant="mine" />);
  });
  return renderer;
}

describe('PendingSubmissionCard', () => {
  it('an expired Instagram preview is not requested: the globe placeholder, the rest of the card unchanged', () => {
    const renderer = renderCard(EXPIRED);
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findAllByType(GlobeIcon)).toHaveLength(1);
    expect(renderer.root.findAll(node => node.props.testID === 'submission-title-9' && node.props.children === 'Proposed link').length).toBeGreaterThan(0);
  });

  it('a valid preview keeps its thumbnail', () => {
    const renderer = renderCard(VALID);
    expect(renderer.root.findByType(Image).props.source).toEqual({ uri: VALID });
    expect(renderer.root.findAllByType(GlobeIcon)).toHaveLength(0);
  });
});
