import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import * as invite from '../lib/collectionInvite.ts';
import * as manage from '../lib/collectionShareManage.ts';
import * as layout from '../lib/collectionSharing.ts';
import { avatarInitial, roleLabel } from '../lib/collectionSharing.ts';
import { STATUS_ICON_MARKUP } from '../lib/collectionIconMarkup.ts';

const ko = getAppDictionary('ko');
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = source('app/(app)/app.module.css');
const sharing = source('app/(app)/collections/[collectionId]/CollectionSharing.tsx');

describe('Web parity: Friends', () => {
  const friends = source('app/(app)/me/friends/page.tsx');

  it('a Juple ID lookup shows the person with the shared Avatar (photo -> initial -> person glyph)', () => {
    assert.match(source('lib/settings.ts'), /interface JupleIdLookup \{[^}]*readonly profileImageUrl\?: string \| null;/);
    assert.match(friends, /data-lookup-result>\s*<Avatar person=\{\{ displayName: found\.displayName, profileImageUrl: found\.profileImageUrl \?\? null \}\} size=\{44\} \/>/);
    assert.equal(avatarInitial('민수'), '민');
    assert.equal(avatarInitial('  '), null, 'no nickname: the person glyph, never a made-up letter');
    assert.match(source('app/(app)/Avatar.tsx'), /isSafeHttpUrl\(person\.profileImageUrl\)/, 'only a safe http(s) URL is ever drawn');
  });

  it('a friend card is avatar | identity (name, @id, memo on ONE ellipsized line) | actions', () => {
    const row = friends.slice(friends.indexOf('function FriendRow'));
    assert.ok(row.indexOf('<Avatar') < row.indexOf('styles.friendName') && row.indexOf('styles.friendName') < row.indexOf('styles.friendNoteLine') && row.indexOf('styles.friendNoteLine') < row.indexOf('styles.friendActions'));
    assert.match(css, /\.friendNoteLine \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    assert.match(css, /\.friendIdentity \{[^}]*min-width: 0;/);
    assert.match(css, /\.friendCard:hover,\s*\.friendCard:focus-within \{/);
  });

  it('the memo button edits the memo; 친구 삭제 is the danger style and still asks first', () => {
    const row = friends.slice(friends.indexOf('function FriendRow'));
    assert.match(row, /onClick=\{\(\) => setEditing\(value => !value\)\}[\s\S]*?\{dictionary\.friendsNote\}/);
    assert.match(row, /className=\{styles\.dangerAction\} data-friend-remove[\s\S]*?onClick=\{onRemove\}/);
    assert.match(friends, /onRemove=\{\(\) => setConfirm\(\{ kind: 'remove', friend \}\)\}/);
    assert.match(friends, /destructive\s*message=\{confirm\?\.kind === 'remove'/);
  });
});

describe('Web parity: Trash', () => {
  const trash = source('app/(app)/me/trash/page.tsx');

  it('two columns from 1200px, one below; the card is neutral and only 영구 삭제 is red', () => {
    assert.match(css, /\.trashGrid \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(css, /@media \(max-width: 1199px\) \{\s*\.trashGrid \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(trash, /className=\{styles\.dangerAction\} disabled=\{busy\} onClick=\{\(\) => setPending\(\{ kind: 'permanent'/);
    assert.doesNotMatch(css.slice(css.indexOf('.trashCard {'), css.indexOf('.trashThumb {')), /danger/);
  });

  it('the original link opens in a new tab, only for a safe http(s) URL, with no opener', () => {
    assert.match(trash, /isSafeHttpUrl\(entry\.url\) \? \(\s*<a className=\{styles\.settingsAction\} href=\{entry\.url\} rel="noopener noreferrer" target="_blank">/);
    assert.match(trash, /\{dictionary\.openLink\}/);
    assert.equal(ko.openLink, '링크 열기');
  });

  it('restore and permanent delete both ask before anything changes; the DTO has no memo so none is invented', () => {
    assert.match(trash, /setPending\(\{ kind: 'restore', id: entry\.id \}\)/);
    assert.match(trash, /setPending\(\{ kind: 'permanent', id: entry\.id \}\)/);
    assert.match(trash, /<ConfirmDialog[\s\S]*?destructive=\{dialog\.destructive\}[\s\S]*?onConfirm=\{run\}/);
    assert.doesNotMatch(trash.slice(trash.indexOf('interface TrashEntry'), trash.indexOf('const TRASH_LIST_LIMIT')), /memo/i);
    assert.doesNotMatch(trash.slice(trash.indexOf('styles.trashGrid')), /entry\.memo/);
  });
});

describe('Web parity: Collection participants', () => {
  it('every participant surface draws the shared Avatar with the real profile image (Collections card, header stack, modal, rail)', () => {
    assert.match(sharing, /export function ParticipantIdentity/);
    assert.match(sharing, /<Avatar person=\{\{ displayName: person\.displayName, profileImageUrl: person\.profileImageUrl, role: person\.role \}\} size=\{40\} \/>/);
    assert.equal((sharing.match(/<ParticipantIdentity/g) ?? []).length >= 4, true, 'modal list + rail: members and pending');
    assert.match(sharing, /<Avatar key=\{person\.jupleId\} person=\{person\} size=\{28\} \/>/, 'the header stack');
    assert.match(source('app/(app)/collections/CollectionsView.tsx'), /preview\.map\(person => \(\s*<Avatar key=\{person\.jupleId\} person=\{person\} size=\{22\} \/>/, 'the Collections grid / list card');
    // The photo URL the server sent reaches the Avatar untouched, never rebuilt from an id, never a fixed placeholder letter.
    assert.match(source('lib/collectionsView.ts'), /participantPreview\?: readonly \{[^}]*profileImageUrl\?: string \| null/);
    assert.doesNotMatch(source('app/(app)/collections/CollectionsView.tsx'), />\s*P\s*</);
  });

  it('Avatar: photo -> initial -> person glyph; a crown only for the server role "owner"', () => {
    const avatar = source('app/(app)/Avatar.tsx');
    assert.match(avatar, /<LinkImage fallback=\{fallback\} src=\{isSafeHttpUrl\(person\.profileImageUrl\)/);
    assert.match(avatar, /\{initial \?\? <Glyph name="User"/);
    assert.match(avatar, /person\.role === 'owner' \? \(/);
    assert.equal(avatarInitial('Pikachu'), 'P');
    assert.equal(avatarInitial(null), null);
    assert.match(css, /\.avatarCrown \{[^}]*position: absolute;[^}]*color: var\(--warning\);/);
  });

  it('the +N chip counts what the preview does not show; the stack keeps at most four', () => {
    const { avatarStackLayout } = layout;
    const ten = Array.from({ length: 10 }, (_, i) => i);
    assert.deepEqual(avatarStackLayout(ten, 4), { visible: [0, 1, 2], hiddenCount: 7 });
    assert.deepEqual(avatarStackLayout([1, 2, 3, 4], 4), { visible: [1, 2, 3, 4], hiddenCount: 0 });
    assert.match(source('app/(app)/collections/CollectionsView.tsx'), /const more = others \+ 1 - preview\.length;/, 'the caller is one of the circles too');
  });

  it('the Owner is marked with a gold crown on the avatar corner and the role badge; never beside the name; others only with their role', () => {
    assert.ok('Crown' in STATUS_ICON_MARKUP);
    assert.match(sharing, /const isOwner = person\.role === 'owner';/);
    assert.doesNotMatch(sharing, /styles\.ownerCrown/, 'no crown next to the name');
    assert.match(css, /\.avatarCrown \{[^}]*inset-inline-end: -5px;[^}]*color: var\(--warning\);/);
    assert.equal(roleLabel('owner', ko), ko.roleOwner);
    assert.match(sharing, /isOwner \? styles\.roleBadgeOwner : styles\.roleBadge/);
  });
});

describe('Web parity: Collection sharing', () => {
  it('the permission values are the real three of the server, with the mobile role names', () => {
    assert.deepEqual([...manage.PUBLIC_PERMISSIONS], ['read', 'submit', 'write']);
    assert.deepEqual([...manage.ROLES], ['viewer', 'submitter', 'contributor']);
    assert.deepEqual(invite.INVITE_ROLES, manage.ROLES, 'invitations offer all three, not two');
    assert.deepEqual(manage.ROLES.map(role => manage.roleOptionLabel(role, ko)), [ko.sharePermissionRead, ko.sharePermissionSubmit, ko.sharePermissionWrite]);
    assert.match(sharing, /PUBLIC_PERMISSIONS\.map\(permission => \(\s*<button/);
    assert.match(sharing, /role="radiogroup"/);
  });

  it('the endpoints are the mobile ones, nothing renamed', () => {
    assert.equal(manage.sharePaths.share(5), '/api/v1/collections/5/share');
    assert.equal(manage.sharePaths.makePrivate(5), '/api/v1/collections/5/share/private');
    assert.equal(manage.sharePaths.permission(5), '/api/v1/collections/5/share/permission');
    assert.equal(manage.sharePaths.collaboratorRole(5, 'AB12CD34'), '/api/v1/collections/5/collaborators/AB12CD34/role');
    assert.equal(manage.sharePaths.collaborator(5, 'AB12CD34'), '/api/v1/collections/5/collaborators/AB12CD34');
    assert.equal(manage.sharePaths.invitation(5, 9), '/api/v1/collections/5/invitations/9');
    assert.equal(manage.sharePaths.invitationRole(5, 9), '/api/v1/collections/5/invitations/9/role');
    assert.equal(manage.sharePaths.password(5), '/api/v1/collections/5/share-password');
    assert.equal(manage.sharePaths.revealPassword(5), '/api/v1/collections/5/share-password/reveal');
  });

  it('turning public ON / OFF and changing its permission; raising lower roles is sent only after the Owner agreed', () => {
    assert.deepEqual(manage.permissionBody('submit', false), { permission: 'submit' });
    assert.deepEqual(manage.permissionBody('write', true), { permission: 'write', raiseLowerRoles: true });
    assert.match(sharing, /method: fresh \? 'POST' : 'PUT',\s*path: fresh \? sharePaths\.share\(collection\.id\) : sharePaths\.permission\(collection\.id\)/);
    assert.match(sharing, /method: 'POST', path: sharePaths\.makePrivate\(collection\.id\)/);
    assert.match(sharing, /role="switch"/);
    const people = { participants: [{ jupleId: 'a', displayName: null, role: 'owner' }, { jupleId: 'b', displayName: null, role: 'viewer' }], pendingInvitations: [{ invitationId: 1, jupleId: 'c', role: 'submitter' }], canManage: true };
    assert.equal(manage.countBelowMinimum(people, 'read'), 0);
    assert.equal(manage.countBelowMinimum(people, 'submit'), 1);
    assert.equal(manage.countBelowMinimum(people, 'write'), 2, 'members AND waiting invitations below the minimum; the Owner is never counted');
    assert.equal(manage.raiseToMinimum('viewer', manage.minimumRoleForPublicPermission('write')), 'contributor');
    assert.equal(manage.raiseToMinimum('contributor', manage.minimumRoleForPublicPermission('submit')), 'contributor');
    assert.equal(manage.isPermissionMismatch(new ApiHttpError(409, 'publicSharePermissionMismatch')), true);
    assert.equal(manage.isPermissionMismatch(new ApiHttpError(409, 'other')), false);
    assert.match(sharing, /kind: 'raise'/);
    assert.match(sharing, /void enableOrChange\(confirmation\.permission, true, !isPublic\)/);
  });

  it('the access password: 4-64 characters, set / change / remove (asked first) / reveal; the value is never kept in state after saving', () => {
    assert.equal(manage.isValidSharePassword('abc'), false);
    assert.equal(manage.isValidSharePassword('abcd'), true);
    assert.equal(manage.isValidSharePassword('a'.repeat(65)), false);
    assert.equal(manage.isValidSharePassword(' abcd'), false, 'no surrounding spaces');
    assert.equal(manage.isValidSharePassword('ab\ncd'), false, 'no control characters');
    assert.deepEqual(manage.sharePasswordBody('s3cret'), { password: 's3cret', confirmPassword: 's3cret' });
    assert.match(sharing, /method: 'PUT', path: sharePaths\.password\(collection\.id\), body: sharePasswordBody\(passwordText\)/);
    assert.match(sharing, /method: 'DELETE', path: sharePaths\.password\(collection\.id\)/);
    assert.match(sharing, /setConfirmation\(\{ kind: 'removePassword' \}\)/);
    assert.match(sharing, /setPasswordStatus\(status\);\s*setPasswordText\(null\);\s*setPasswordVisible\(false\);\s*setRevealed\(null\);/);
    assert.doesNotMatch(sharing, /localStorage|sessionStorage|document\.cookie|console\./);
    assert.equal(manage.sharePasswordErrorMessage(new ApiHttpError(409, 'sharePasswordUnreadable'), ko), ko.accessPasswordUnreadable);
  });

  it('members and invitations: change role, remove a member, cancel an invitation - each asks first and uses the mobile endpoints', () => {
    // One role-change path for both (it also shows the asked role at once and puts the server's back on a refusal).
    assert.match(sharing, /await api<unknown>\(\{ method: 'PUT', path, body: \{ role \}, headers: unlockHeaders\(collection\.id\) \}\);/);
    assert.match(sharing, /changeRole\(`member-\$\{person\.jupleId\}`, role, sharePaths\.collaboratorRole\(collection\.id, person\.jupleId\)\)/);
    assert.match(sharing, /changeRole\(`invitation-\$\{invitation\.invitationId\}`, role, sharePaths\.invitationRole\(collection\.id, invitation\.invitationId\)\)/);
    assert.match(sharing, /setConfirmation\(\{ kind: 'removeMember', person \}\)/);
    assert.match(sharing, /setConfirmation\(\{ kind: 'cancelInvitation', invitation \}\)/);
    assert.match(sharing, /method: 'DELETE', path: sharePaths\.invitation\(collection\.id, invitation\.invitationId\)/);
    assert.match(sharing, /editable = canManage && person\.role !== 'owner' && !person\.isMe/);
    assert.equal(manage.shareActionErrorMessage(new ApiHttpError(409, 'invitationNotPending'), ko), ko.invitationNoLongerValid);
    assert.equal(manage.shareActionErrorMessage(new ApiHttpError(409, 'alreadyCollaborator'), ko), ko.inviteAlreadyCollaborator);
  });

  it('the friend picker offers all three roles, never one below the public link, and keeps existing members / pending unselectable', () => {
    const picker = source('app/(app)/collections/[collectionId]/FriendPicker.tsx');
    assert.match(picker, /const role = raiseToMinimum\(chosenRole, minimumRole\);/);
    assert.match(picker, /disabled=\{minimumRole !== null && INVITATION_ROLE_RANK\[option\] < INVITATION_ROLE_RANK\[minimumRole\]\}/);
    assert.match(picker, /disabled=\{blocked \|\| busy\}/);
    const unavailable = invite.unavailableFriends({ participants: [{ jupleId: 'a', displayName: null, role: 'owner' }], pendingInvitations: [{ invitationId: 1, jupleId: 'b', role: 'viewer' }], canManage: true });
    assert.deepEqual([unavailable.get('a'), unavailable.get('b')], ['member', 'pending']);
  });

  it('a workspace: settings left with dividers, people right; the legacy shared lock blocks new recipients with its notice', () => {
    assert.ok(sharing.indexOf('styles.shareSettings') < sharing.indexOf('styles.shareRail'));
    assert.match(sharing, /disabled=\{legacy\} onClick=\{\(\) => setPickerOpen\(true\)\}/);
    assert.match(sharing, /\{legacy \? <p className=\{styles\.stateMessage\}>\{dictionary\.accessPasswordLegacyNotice\}<\/p> : null\}/);
    assert.match(css, /\.shareRail \.personText > \* \{\s*overflow: hidden;\s*text-overflow: ellipsis;\s*white-space: nowrap;/);
  });
});

describe('Web parity: the settings shell', () => {
  it('every settings page lives under the one me/layout.tsx shell and none draws its own rail', () => {
    const frame = source('app/(app)/me/layout.tsx');
    assert.match(frame, /<nav aria-label=\{dictionary\.settingsSectionTitle\} className=\{styles\.settingsRail\}>/);
    for (const route of ['me/page.tsx', 'me/ProfileEditView.tsx', 'me/language/page.tsx', 'me/collection-lock/page.tsx', 'me/subscription/page.tsx', 'me/account/page.tsx', 'me/account/delete/page.tsx']) {
      assert.doesNotMatch(source(`app/(app)/${route}`), /settingsRail|settingsNavLink|SETTINGS_NAV_ITEMS|<nav\b/, route);
    }
    assert.equal(source('app/(app)/me/layout.tsx').match(/<nav\b/g)?.length, 1);
  });

  it('the rail lists exactly the real settings, grouped by dividers; 친구 and 삭제 이력 are not in it', async () => {
    const nav = await import('../lib/settingsNav.ts');
    assert.deepEqual(nav.SETTINGS_NAV_ITEMS.map(item => item.key), ['profile', 'language', 'collectionLock', 'subscription', 'account', 'support', 'deleteAccount']);
    assert.ok(nav.SETTINGS_NAV_ITEMS.every(item => !/friends|trash/.test(item.href)));
    assert.deepEqual(nav.SETTINGS_NAV_ITEMS.map(item => item.group), [0, 0, 1, 2, 2, 3, 4]);
    for (const [path, key] of [['/me', 'profile'], ['/me/profile', 'profile'], ['/me/language', 'language'], ['/me/collection-lock', 'collectionLock'], ['/me/subscription', 'subscription'], ['/me/account', 'account'], ['/me/support', 'support'], ['/me/account/delete', 'deleteAccount']] as const) {
      assert.equal(nav.activeSettingsItem(path)?.key, key, path);
    }
    assert.equal(nav.activeSettingsItem('/me/friends'), null);
    assert.equal(nav.activeSettingsItem('/me/trash'), null);
    assert.match(source('app/(app)/me/layout.tsx'), /aria-current=\{item\.key === active\.key \? 'page' : undefined\}/);
  });
});

describe('Web: 내 페이지 is called 설정', () => {
  it('the side bar item, the page title and the rail title all say 설정, with a gear; the routes stay', async () => {
    const nav = source('lib/appNavigation.ts');
    assert.match(nav, /\{ href: '\/me', labelKey: 'settingsSectionTitle', icon: 'Settings' \}/);
    assert.match(source('app/(app)/me/layout.tsx'), /<h2 className=\{styles\.settingsRailTitle\}>\{dictionary\.settingsSectionTitle\}<\/h2>/);
    assert.ok('Settings' in STATUS_ICON_MARKUP);
    assert.equal(ko.settingsSectionTitle, '설정');
    assert.equal(getAppDictionary('en').settingsSectionTitle, 'Settings');
    assert.doesNotMatch(source('app/(app)/AppShell.tsx') + nav, /navMyPage/);
    const routes = await import('../lib/settingsNav.ts');
    assert.deepEqual(routes.SETTINGS_NAV_ITEMS.map(item => item.href), ['/me', '/me/language', '/me/collection-lock', '/me/subscription', '/me/account', '/me/support', '/me/account/delete']);
  });
});
