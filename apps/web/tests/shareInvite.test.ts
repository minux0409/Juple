import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiHttpError } from '../lib/appApi.ts';
import { getAppDictionary } from '../lib/appDictionary.ts';
import {
  JUPLE_ID_LOOKUP_PATH,
  idInviteBody,
  idInviteUnavailable,
  idInviteUnavailableMessage,
  invitationsPath,
  inviteErrorMessage,
  selectableRoles,
} from '../lib/collectionInvite.ts';
import type { CollectionParticipants } from '../lib/collectionSharing.ts';
import { lookupFailure, normalizeTypedJupleId } from '../lib/settings.ts';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = source('app/(app)/app.module.css');
const sharing = source('app/(app)/collections/[collectionId]/CollectionSharing.tsx');
const rule = (selector: string) => {
  let start = css.indexOf(`\n${selector} {`);
  while (start > 0 && css.slice(0, start).trimEnd().endsWith(',')) {
    start = css.indexOf(`\n${selector} {`, start + 1);
  }
  assert.ok(start >= 0, selector);
  return css.slice(start, css.indexOf('\n}', start));
};
const ko = getAppDictionary('ko');

const people: CollectionParticipants = {
  participants: [
    { jupleId: 'MEME0001', displayName: '나', role: 'owner', isMe: true },
    { jupleId: 'OTHR0002', displayName: '다른참여자', role: 'contributor' },
  ],
  pendingInvitations: [{ invitationId: 7, jupleId: 'PEND0004', role: 'submitter', displayName: '대기' }],
  canManage: true,
};

describe('ID로 초대: the existing Backend API, the mobile rules', () => {
  it('reuses the exact-ID lookup and the invitation endpoint (the same ones mobile and 친구 추가 call)', () => {
    assert.equal(JUPLE_ID_LOOKUP_PATH, '/api/v1/users/lookup-by-juple-id');
    assert.equal(invitationsPath(12), '/api/v1/collections/12/invitations');
    const mobile = repo('apps/mobile/src/collections/api/collaborationApi.ts');
    assert.match(mobile, /path: '\/api\/v1\/users\/lookup-by-juple-id'/);
    assert.match(mobile, /path: `\/api\/v1\/collections\/\$\{collectionId\}\/invitations`,\s*body: \{ jupleId, role \}/);
    const controller = repo('backend/src/Juple.Api/Controllers/CollectionsController.cs');
    assert.match(controller, /\[HttpPost\("\{id:long\}\/invitations"\)\]/);
  });

  it('the typed ID is compared without @, spaces, the display hyphen or case; the lookup runs only on 찾기 (a form submit)', () => {
    assert.equal(normalizeTypedJupleId(' @newu-0005 '), 'NEWU0005');
    assert.match(sharing, /<form className=\{styles\.idInviteForm\} onSubmit=\{find\}>/);
    assert.match(sharing, /api<JupleIdLookup>\(\{ method: 'POST', path: JUPLE_ID_LOOKUP_PATH, body: \{ jupleId \} \}\)/);
  });

  it('user not found / too many requests use the mobile lookup words', () => {
    assert.equal(lookupFailure(new ApiHttpError(404, null), ko), ko.lookupNotFound);
    assert.equal(lookupFailure(new ApiHttpError(429, null), ko), ko.tooManyRequests);
  });

  it('already participating, already invited and myself are said plainly - and nothing is offered to send', () => {
    assert.equal(idInviteUnavailable({ jupleId: 'OTHR0002' }, people), 'member');
    assert.equal(idInviteUnavailable({ jupleId: 'PEND0004' }, people), 'pending');
    assert.equal(idInviteUnavailable({ jupleId: 'MEME0001' }, people), 'self');
    assert.equal(idInviteUnavailable({ jupleId: 'ANY00000', isSelf: true }, people), 'self');
    assert.equal(idInviteUnavailable({ jupleId: 'NEWU0005' }, people), null);
    assert.equal(idInviteUnavailableMessage('member', ko), ko.inviteAlreadyCollaborator);
    assert.equal(idInviteUnavailableMessage('pending', ko), ko.inviteAlreadyPending);
    assert.equal(idInviteUnavailableMessage('self', ko), ko.inviteSelf);
    assert.match(sharing, /\{unavailable !== null \? \(\s*<p className=\{styles\.stateMessage\} role="status">/);
  });

  it('the server refusing anyway is mapped too (409 alreadyCollaborator / invitationPending)', () => {
    assert.equal(inviteErrorMessage(new ApiHttpError(409, 'alreadyCollaborator'), ko), ko.inviteAlreadyCollaborator);
    assert.equal(inviteErrorMessage(new ApiHttpError(409, 'invitationPending'), ko), ko.inviteAlreadyPending);
  });

  it('invite success sends { jupleId, role } with the chosen role - never below the public link\'s level - then refreshes the people', () => {
    assert.deepEqual(idInviteBody('NEWU0005', 'contributor', null), { jupleId: 'NEWU0005', role: 'contributor' });
    assert.deepEqual(idInviteBody('NEWU0005', 'viewer', 'submitter'), { jupleId: 'NEWU0005', role: 'submitter' });
    assert.match(sharing, /body: idInviteBody\(lookup\.person\.jupleId, role, minimumRole\), headers: unlockHeaders\(collectionId\)/);
    assert.match(sharing, /setTyped\(''\);\s*setChosenRole\('viewer'\);\s*setLookup\(\{ kind: 'idle' \}\);\s*onInvited\(\);/);
  });

  it('permission selection offers only the real roles, lowest first, none below the public link', () => {
    assert.deepEqual(selectableRoles(null), ['viewer', 'submitter', 'contributor']);
    assert.deepEqual(selectableRoles('submitter'), ['submitter', 'contributor']);
    assert.deepEqual(selectableRoles('contributor'), ['contributor']);
    assert.match(sharing, /disabled=\{sending \|\| raiseToMinimum\(option, minimumRole\) !== option\}/);
  });

  it('the invite area offers both ways: 친구에서 선택 and ID로 초대 (mobile tab words)', () => {
    assert.match(sharing, /\{mode === 'friends' \? dictionary\.inviteTabFriends : dictionary\.inviteTabId\}/);
    assert.match(sharing, /<IdInvite collectionId=\{collection\.id\}/);
    assert.equal(ko.inviteTabFriends, '친구');
    assert.equal(ko.inviteTabId, 'ID');
    assert.equal(ko.inviteFind, '찾기');
  });
});

describe('participants and invitations: rows, roles, destructive actions', () => {
  it('participant role change: the asked role shows at once with the row busy; a refusal puts the server role back', () => {
    assert.match(sharing, /setRoleChange\(\{ key, role, source: participants \}\);/);
    assert.match(sharing, /caught => \{\s*setRoleChange\(null\);\s*return actionWords\(caught\);/);
    assert.match(sharing, /roleChange\.source === participants \? roleChange\.role : invitationRoleOf\(serverRole\)/);
    assert.match(sharing, /changing=\{busy && roleChange\?\.key === key\}/);
  });

  it('a role change below the public link\'s level is refused before anything is sent (mobile)', () => {
    assert.match(sharing, /if \(raiseToMinimum\(role, minimumRole\) !== role\) \{\s*setMessage\(\{ text: dictionary\.belowPublicPermission, error: true \}\);\s*return;/);
  });

  it('the Owner\'s role is immutable: no chooser and no remove on the Owner (or my own) row - the 소유자 badge instead', () => {
    assert.match(sharing, /const editable = canManage && person\.role !== 'owner' && !person\.isMe;/);
    assert.match(sharing, /\{trailing \?\? \(role \? <span className=\{isOwner \? styles\.roleBadgeOwner : styles\.roleBadge\}>\{role\}<\/span> : null\)\}/);
  });

  it('remove and cancel keep their confirmations and endpoints', () => {
    assert.match(sharing, /onClick=\{\(\) => setConfirmation\(\{ kind: 'removeMember', person \}\)\}/);
    assert.match(sharing, /onClick=\{\(\) => setConfirmation\(\{ kind: 'cancelInvitation', invitation \}\)\}/);
    assert.match(sharing, /method: 'DELETE', path: sharePaths\.collaborator\(collection\.id, person\.jupleId\)/);
    assert.match(sharing, /method: 'DELETE', path: sharePaths\.invitation\(collection\.id, invitation\.invitationId\)/);
  });

  it('row destructive actions are subtle: red icon, a faint red wash on hover, never a filled red button', () => {
    assert.equal((sharing.match(/className=\{styles\.rowDanger\}\s*data-destructive/g) ?? []).length, 2);
    const danger = rule('.rowDanger');
    assert.match(danger, /background: transparent;/);
    assert.match(danger, /color: var\(--danger\);/);
    assert.match(css, /\.rowDanger:hover:not\(:disabled\),\n\.rowDanger:focus-visible \{\s*background: var\(--danger-soft\);/);
  });

  it('participants and invitations are separate card lists; an invitation is dashed and says 수락 대기 under its @ID', () => {
    assert.match(sharing, /<ul className=\{styles\.personCards\} data-members>/);
    assert.match(sharing, /<ul className=\{styles\.personCards\} data-pending>/);
    assert.match(sharing, /\{pending \? <span className=\{styles\.pendingCaption\}>\{dictionary\.participantsPendingStatus\}<\/span> : null\}/);
    assert.match(rule('.personCardPending'), /border-style: dashed;/);
  });

  it('the role badge has one fixed width, so changing it never moves the row', () => {
    assert.match(rule('.roleControl'), /width: 128px;/);
    assert.match(css, /\.roleControl \.roleSelect \{[^}]*width: 100%;[^}]*appearance: none;/);
  });

  it('a solo Owner\'s modal still gets everything (participants read whenever the share screen is open)', () => {
    assert.match(source('app/(app)/collections/[collectionId]/CollectionDetailsView.tsx'), /isCollaborative\(loadedCollection\) \|\| panel === 'share'/);
  });
});

describe('share modal layout', () => {
  it('two columns on desktop (settings + invite | people), one below 900px; the people list scrolls inside', () => {
    const lastWorkspace = css.lastIndexOf('\n.shareWorkspace {');
    assert.match(css.slice(lastWorkspace), /grid-template-columns: minmax\(0, 1\.1fr\) minmax\(340px, 1fr\);\s*align-items: stretch;/);
    assert.match(css, /@media \(max-width: 899px\) \{\s*\.shareWorkspace \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    assert.match(rule('.shareRailScroll'), /max-height: min\(56vh, 560px\);[\s\S]*overflow-y: auto;/);
    // An older unused .shareCard rule must not leak into the rows (their own class name).
    assert.doesNotMatch(sharing, /styles\.shareCard\b/);
  });
});

describe('CJK fonts', () => {
  const globals = source('app/globals.css');
  const stack = globals.slice(globals.indexOf('font-family:'), globals.indexOf(';', globals.indexOf('font-family:')));

  it('Latin first, then Korean, Japanese, Simplified and Traditional Chinese system fonts; no web / brand font', () => {
    const order = ["'Segoe UI'", "'Pretendard Variable'", "'Apple SD Gothic Neo'", "'Noto Sans KR'", "'Malgun Gothic'", "'Hiragino Sans'", "'Yu Gothic UI'", 'Meiryo', "'PingFang SC'", "'Microsoft YaHei'", "'Noto Sans SC'", "'PingFang TC'", "'Microsoft JhengHei'", "'Noto Sans TC'"];
    let last = -1;
    for (const family of order) {
      const at = stack.indexOf(family);
      assert.ok(at > last, family);
      last = at;
    }
    assert.doesNotMatch(globals + css, /@font-face|fonts\.googleapis|Instagram/i);
  });

  it('never a synthesized bold, anywhere; user-content titles stay 600', () => {
    assert.match(globals, /font-synthesis-weight: none;/);
    assert.match(rule('.quickTitle'), /font-weight: 600;/);
    assert.match(rule('.itemTitle'), /font-weight: 600;/);
    assert.match(rule('.linkTitle'), /font-weight: 600;/);
  });

  it('the 계정 rows keep one typography (settingsRow + settingsLabel for 비밀번호 재설정)', () => {
    assert.match(source('app/(app)/me/MyPageSections.tsx'), /<button className=\{`\$\{styles\.settingsRow\} \$\{styles\.settingsRowAction\}`\}[\s\S]{0,120}?type="button">\s*<span className=\{styles\.settingsLabel\}>\{dictionary\.accountPasswordReset\}/);
  });
});
