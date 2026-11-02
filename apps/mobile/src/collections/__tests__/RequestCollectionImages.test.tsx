import { act, create } from 'react-test-renderer';
import { Image } from 'react-native';
import { AppToastProvider } from '../../components/AppToast';
import { ReceivedApprovalsSheet } from '../ReceivedApprovalsSheet';
import { ReceivedInvitationsSheet } from '../ReceivedInvitationsSheet';
import { PendingSubmissionCard } from '../PendingSubmissionCard';
import type { Collection } from '../api/collectionsApi';
import '../../i18n';

const photo = 'https://images.example.test/owner-collection.jpg';
const collection = { id: 41, name: 'Photo collection', icon: 'Folder', color: null, iconImageUrl: photo, iconImageVersion: 'photo-v1' } as Collection;
const request = jest.fn();

it.each([true, false])('received invitations and approvals use the actual collection photo, present=%s', hasPhoto => {
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<AppToastProvider>
    <ReceivedApprovalsSheet visible collections={[{ ...collection, iconImageUrl: hasPhoto ? photo : null }]} onClose={() => {}} onOpen={() => {}} />
    <ReceivedInvitationsSheet visible authenticatedRequest={request} onClose={() => {}} onResponded={() => {}} onStale={() => {}} invitations={[{
      invitationId: 1, collectionId: 41, collectionName: 'Photo collection', icon: 'Folder', color: null,
      ownerJupleId: 'OWNER123', role: 'Viewer', createdAtUtc: '2026-11-02T00:00:00Z', expiresAtUtc: '2026-11-09T00:00:00Z',
      iconImageUrl: hasPhoto ? photo : null, iconImageVersion: hasPhoto ? 'photo-v1' : null,
    }]} />
  </AppToastProvider>); });
  expect(tree.root.findAllByType(Image).filter(node => node.props.source?.uri === photo)).toHaveLength(hasPhoto ? 2 : 0);
});

it('sent approval requests use the destination photo and keep a non-member request generic', () => {
  let tree!: ReturnType<typeof create>;
  const row = { submissionId: 7, url: 'https://example.test', title: 'Link', previewImageUrl: null, submittedAtUtc: '2026-11-02T00:00:00Z', collectionId: 41, collectionName: collection.name, collectionIcon: 'Folder', collectionIconImageUrl: photo };
  act(() => { tree = create(<PendingSubmissionCard row={row} variant="mine" />); });
  expect(tree.root.findAllByType(Image).filter(node => node.props.source?.uri === photo)).toHaveLength(1);
  act(() => tree.update(<PendingSubmissionCard row={{ ...row, collectionId: null, collectionName: null }} variant="mine" />));
  expect(tree.root.findAllByType(Image)).toHaveLength(0);
});

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
