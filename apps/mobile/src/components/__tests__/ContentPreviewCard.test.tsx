import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, InputAccessoryView, Text } from 'react-native';
import { ContentPreviewCard } from '../ContentPreviewCard';

// oe 60000000 = 2021-01-14 (long past), F0000000 = 2097-08-05 (far future): no clock control needed.
const EXPIRED = 'https://scontent-ssn1-1.cdninstagram.com/v/p.jpg?oh=00_sig&oe=60000000';
const VALID = 'https://scontent-ssn1-1.cdninstagram.com/v/p.jpg?oh=00_sig&oe=F0000000';

function renderCard(previewImageUrl: string | null) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ContentPreviewCard onChangeTitle={jest.fn()} previewImageUrl={previewImageUrl} titlePlaceholder="제목" titleValue="A title">
        <Text>source row</Text>
      </ContentPreviewCard>,
    );
  });
  return renderer;
}

describe('ContentPreviewCard', () => {
  it('an expired Instagram preview is not requested: the card has no picture, everything else stays', () => {
    const renderer = renderCard(EXPIRED);
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    // The card's own text only (not the iOS keyboard toolbar that the title field carries).
    const inToolbar = (node: ReactTestRenderer.ReactTestInstance) => {
      for (let current = node.parent; current; current = current.parent) {
        if (current.type === InputAccessoryView) {
          return true;
        }
      }
      return false;
    };
    expect(renderer.root.findAllByType(Text).filter(node => !inToolbar(node)).map(node => node.props.children)).toEqual(['source row']);
  });

  it('a valid preview, and any other site\'s picture, keep their source', () => {
    expect(renderCard(VALID).root.findByType(Image).props.source).toEqual({ uri: VALID });
    expect(renderCard('https://img.example/p.jpg').root.findByType(Image).props.source).toEqual({ uri: 'https://img.example/p.jpg' });
    expect(renderCard(null).root.findAllByType(Image)).toHaveLength(0);
  });
});
