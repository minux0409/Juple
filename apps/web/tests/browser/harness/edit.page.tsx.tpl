'use client';
// The link details' Collection choice (the picker inside the details' Collection dialog) on the real record + editor hooks, without the dialog
// shell: the locked-Collection scenarios look at the picker itself.
import { useEffect } from 'react';
import { StubApp } from '../StubApp';
import { CollectionPicker } from '../../(app)/CollectionPicker';
import { useItemEditor } from '../../(app)/items/[itemId]/useItemEditor';
import { useItemRecord } from '../../(app)/items/[itemId]/useItemRecord';
import { isRemovalOwnerOnly } from '../../../lib/itemEdit';

function Details() {
  const record = useItemRecord(7, null);
  const editor = useItemEditor({ itemId: 7, record, onSaved: () => undefined });
  const { loadDestinationsNow } = editor;
  useEffect(() => {
    loadDestinationsNow();
  }, [loadDestinationsNow]);
  return (
    <CollectionPicker
      clearable
      destinations={editor.membershipsReady ? editor.options : null}
      failed={editor.destinationsFailed}
      isDeselectBlocked={collection => editor.original.has(collection.id) && isRemovalOwnerOnly(collection)}
      noneSelected={editor.selected.length === 0}
      onCreated={editor.onCreated}
      onRefreshed={editor.onRefreshed}
      onToggle={editor.toggleCollection}
      onUnavailable={editor.onUnavailable}
      selectedIds={editor.selectedIds}
      session={editor.pickerSession}
    />
  );
}

export default function Page() {
  return (
    <StubApp>
      <Details />
    </StubApp>
  );
}
