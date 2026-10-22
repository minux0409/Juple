'use client';
import { StubApp } from '../StubApp';
import { ItemEditView } from '../../(app)/items/[itemId]/edit/ItemEditView';

export default function Page() {
  return (
    <StubApp>
      <ItemEditView fromCollectionId={null} itemIdParam="7" lockedBy={null} />
    </StubApp>
  );
}
