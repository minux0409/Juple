using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.Comments;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.NotificationPreference;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.Reactions;
using Juple.Application.Collections.RevokeCollectionShare;
using Juple.Application.Collections.Submissions;
using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Notifications;

/// <summary>
/// Collaboration pushes against the real schema (Types 8-12): a reaction or comment on someone's link
/// tells that link's owner (never the reactor/commenter themselves, never the text, never on delete),
/// a proposal tells the Collection's Owner (never who proposed), and its approval or rejection tells
/// the proposer - also someone who proposed through the public link. Each is re-checked when the
/// push-dispatch Job runs.
/// </summary>
public sealed class CollaborationNotificationsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _submitter;
    private long _sharedId;
    private CollectionUnlockTokenProtector _tokens = null!;
    private CollectionAccessService _access = null!;
    private CollectionStore _collections = null!;
    private CollectionCollaborationService _collaboration = null!;
    private SocialNotificationPublisher _publisher = null!;
    private CollectionItemReactionService _reactions = null!;
    private CollectionItemCommentService _comments = null!;
    private readonly RecordingPushSender _sender = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _submitter = await NewUserAsync();
        var profiles = new UserProfileService(new UserProfileStore(_db), TimeProvider.System);
        await profiles.SetDisplayNameAsync(_owner, "피카츄");
        await profiles.SetDisplayNameAsync(_member, "꼬부기");
        await profiles.SetDisplayNameAsync(_submitter, "파이리");

        _publisher = new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _collections = new CollectionStore(_db);
        _collaboration = new CollectionCollaborationService(_access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _reactions = new CollectionItemReactionService(_access, new CollectionItemReactionStore(_db), TimeProvider.System, _publisher);
        _comments = new CollectionItemCommentService(_access, new CollectionItemCommentStore(_db), TimeProvider.System, _publisher);

        _sharedId = (await _collections.CreateAsync(_owner, "여행", "여행", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await InviteAndAcceptAsync(_sharedId, _member, CollectionCollaboratorRole.Contributor);
        await InviteAndAcceptAsync(_sharedId, _submitter, CollectionCollaboratorRole.Submitter);
        await RegisterDeviceAsync(_owner, "ko");
        await RegisterDeviceAsync(_member, "ko");
        await RegisterDeviceAsync(_submitter, "ko");
        await Dispatcher().RunOnceAsync(); // the invitation pushes above are not what these tests look at
        _sender.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    // ---------- reactions ----------

    [Fact]
    public async Task AReaction_TellsTheLinksOwner_OnceForANewOrChangedOne_NeverForTheSameOne()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/owner-link");

        await _reactions.SetAsync(_member, _sharedId, link, "heart", null);
        await _reactions.SetAsync(_member, _sharedId, link, "heart", null); // the same one: nothing changed
        await Dispatcher().RunOnceAsync();

        var push = Assert.Single(Sent(_owner, "collectionItemReaction"));
        Assert.Equal(("새 반응", "꼬부기님이 '여행'에 있는 내 링크에 반응을 남겼어요."), (push.Title, push.Body));
        Assert.Equal(["collectionId"], push.Data.Keys); // no Item id, no reaction, no URL
        Assert.Equal(_sharedId.ToString(), push.Data["collectionId"]);
        Assert.Empty(Sent(_member, "collectionItemReaction")); // the reactor is never told
        Assert.Single(await RowsAsync(NotificationType.CollectionItemReactionReceived));

        // A change after the coalescing window is a new notification; within it, the same one.
        await AgeCollaborationRowsAsync();
        await _reactions.SetAsync(_member, _sharedId, link, "fire", null);
        await Dispatcher().RunOnceAsync();
        Assert.Equal(2, Sent(_owner, "collectionItemReaction").Count);
    }

    [Fact]
    public async Task ReactingToMyOwnLink_OrTakingAReactionBack_TellsNobody()
    {
        var link = await AddLinkAsync(_member, "https://example.test/member-link");

        await _reactions.SetAsync(_member, _sharedId, link, "heart", null); // my own link
        await _reactions.DeleteAsync(_member, _sharedId, link, null);
        await Dispatcher().RunOnceAsync();

        Assert.Empty(await RowsAsync(NotificationType.CollectionItemReactionReceived));
        Assert.Empty(_sender.All.Where(sent => sent.Payload.Type is "collectionItemReaction" or "collectionItemComment"));
    }

    [Fact]
    public async Task TheRecipientIsTheLinksOwner_NotTheCollectionsOwner()
    {
        var link = await AddLinkAsync(_member, "https://example.test/member-link");

        await _reactions.SetAsync(_owner, _sharedId, link, "heart", null);
        await Dispatcher().RunOnceAsync();

        Assert.Single(Sent(_member, "collectionItemReaction"));
        Assert.Empty(Sent(_owner, "collectionItemReaction"));
    }

    [Fact]
    public async Task AtDispatch_ATakenBackReaction_ARemovedLink_OrALeftCollection_IsNotPushed()
    {
        var takenBack = await AddLinkAsync(_owner, "https://example.test/a");
        await _reactions.SetAsync(_member, _sharedId, takenBack, "heart", null);
        await _reactions.DeleteAsync(_member, _sharedId, takenBack, null);

        var removed = await AddLinkAsync(_owner, "https://example.test/b");
        await _reactions.SetAsync(_member, _sharedId, removed, "heart", null);
        await _db.CollectionItems.Where(entry => entry.CollectionId == _sharedId && entry.ItemId == removed).ExecuteDeleteAsync();

        var leftLink = await AddLinkAsync(_member, "https://example.test/c");
        await _comments.CreateAsync(_owner, _sharedId, leftLink, "hello", null);
        await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _sharedId && entry.UserId == _member).ExecuteDeleteAsync();

        await Dispatcher().RunOnceAsync();

        Assert.Empty(_sender.All.Where(sent => sent.Payload.Type is "collectionItemReaction" or "collectionItemComment"));
        // Each one was decided on (skipped), not left pending.
        Assert.All(await RowsAsync(NotificationType.CollectionItemReactionReceived), row => Assert.NotNull(row.DispatchedAtUtc));
        Assert.All(await RowsAsync(NotificationType.CollectionItemCommentReceived), row => Assert.NotNull(row.DispatchedAtUtc));
    }

    // ---------- comment replies and hearts (Types 15-16) ----------

    [Fact]
    public async Task AReply_TellsOnlyTheAnsweredPerson_NeverTheLinksOwnerOrTheRoot_AndNeverTheText()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/thread");
        var top = await _comments.CreateAsync(_member, _sharedId, link, "top by the member", null);
        await Dispatcher().RunOnceAsync();
        _sender.Clear();

        var first = await _comments.CreateAsync(_submitter, _sharedId, link, "비밀 답글 secret-reply", null, top.Id);
        await Dispatcher().RunOnceAsync();

        var push = Assert.Single(Sent(_member, "commentReply"));
        Assert.Equal(("새 답글", "파이리님이 회원님의 댓글에 답글을 남겼어요."), (push.Title, push.Body));
        Assert.Equal(["collectionId"], push.Data.Keys.Where(key => key != "notificationId"));
        Assert.DoesNotContain("secret-reply", push.Body);
        Assert.Empty(Sent(_owner, "commentReply")); // the link's owner is not the answered person
        Assert.Empty(Sent(_owner, "collectionItemComment")); // and a reply is not a new top-level comment
        Assert.Empty(Sent(_submitter, "commentReply")); // never the replier

        // A reply to that reply tells ITS author - not the thread's root author.
        _sender.Clear();
        await _comments.CreateAsync(_owner, _sharedId, link, "reply to the reply", null, first.Id);
        await Dispatcher().RunOnceAsync();

        Assert.Single(Sent(_submitter, "commentReply"));
        Assert.Empty(Sent(_member, "commentReply"));
        var rows = await RowsAsync(NotificationType.CommentReplyReceived);
        Assert.Equal(2, rows.Count);
        Assert.All(rows, row => Assert.Equal(link, row.ItemId));
    }

    [Fact]
    public async Task ReplyingToMyOwnComment_OrADeletedReply_TellsNobody()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/own-thread");
        var top = await _comments.CreateAsync(_member, _sharedId, link, "mine", null);
        await Dispatcher().RunOnceAsync();
        _sender.Clear();

        await _comments.CreateAsync(_member, _sharedId, link, "answering myself", null, top.Id);
        var regretted = await _comments.CreateAsync(_submitter, _sharedId, link, "oops", null, top.Id);
        await _comments.DeleteAsync(_submitter, _sharedId, link, regretted.Id, null); // before the Job runs
        await Dispatcher().RunOnceAsync();

        Assert.Empty(await RowsAsync(NotificationType.CommentReplyReceived));
        Assert.Empty(_sender.All.Where(sent => sent.Payload.Type == "commentReply"));
    }

    [Fact]
    public async Task AHeart_TellsTheCommentsAuthor_OncePerPersonAndComment_NeverOnUnlikeOrForOnesOwn()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/hearts");
        var top = await _comments.CreateAsync(_member, _sharedId, link, "heart me", null);
        await Dispatcher().RunOnceAsync();
        _sender.Clear();

        await _comments.SetLikeAsync(_submitter, _sharedId, link, top.Id, true, null);
        await _comments.SetLikeAsync(_submitter, _sharedId, link, top.Id, true, null); // a retry
        await _comments.SetLikeAsync(_member, _sharedId, link, top.Id, true, null); // my own comment
        await Dispatcher().RunOnceAsync();

        var push = Assert.Single(Sent(_member, "commentLike"));
        Assert.Equal(("댓글 좋아요", "파이리님이 회원님의 댓글을 좋아합니다."), (push.Title, push.Body));
        Assert.Single(await RowsAsync(NotificationType.CommentLikeReceived));

        // Un-hearting tells nobody, and hearting again is not a second notification - not even a window later.
        _sender.Clear();
        await _comments.SetLikeAsync(_submitter, _sharedId, link, top.Id, false, null);
        await _comments.SetLikeAsync(_submitter, _sharedId, link, top.Id, true, null);
        await Dispatcher().RunOnceAsync();

        Assert.Empty(Sent(_member, "commentLike"));
        Assert.Single(await RowsAsync(NotificationType.CommentLikeReceived));
    }

    [Fact]
    public async Task AHeartTakenBackBeforeTheJobRuns_IsNeverAnnounced()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/fleeting");
        var top = await _comments.CreateAsync(_member, _sharedId, link, "fleeting", null);
        await Dispatcher().RunOnceAsync();
        _sender.Clear();

        await _comments.SetLikeAsync(_submitter, _sharedId, link, top.Id, true, null);
        await _comments.SetLikeAsync(_submitter, _sharedId, link, top.Id, false, null);
        await Dispatcher().RunOnceAsync();

        Assert.Empty(await RowsAsync(NotificationType.CommentLikeReceived));
        Assert.Empty(Sent(_member, "commentLike"));
    }

    // ---------- comments ----------

    [Fact]
    public async Task AComment_TellsTheLinksOwner_NeverItsText_AndADeletedOneIsNotPushedLate()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/commented");

        await _comments.CreateAsync(_member, _sharedId, link, "비밀 내용 secret-body", null);
        await _comments.CreateAsync(_owner, _sharedId, link, "my own reply", null); // on my own link: nobody
        await Dispatcher().RunOnceAsync();

        var push = Assert.Single(Sent(_owner, "collectionItemComment"));
        Assert.Equal(("새 댓글", "꼬부기님이 '여행'에 있는 내 링크에 댓글을 남겼어요."), (push.Title, push.Body));
        Assert.DoesNotContain("secret", push.Body);
        Assert.DoesNotContain(push.Data.Values, value => value.Contains("secret") || value.Contains("example.test"));
        Assert.Equal(["collectionId"], push.Data.Keys);
        Assert.Empty(Sent(_member, "collectionItemComment"));

        // A comment deleted before the Job runs is never announced (on another link: the recheck is
        // whether the commenter still has any comment there, as one notification covers several).
        _sender.Clear();
        var other = await AddLinkAsync(_owner, "https://example.test/deleted-comment");
        var second = await _comments.CreateAsync(_member, _sharedId, other, "oops", null);
        await _comments.DeleteAsync(_member, _sharedId, other, second.Id, null);
        await Dispatcher().RunOnceAsync();
        Assert.Empty(Sent(_owner, "collectionItemComment"));
        Assert.NotNull((await RowsAsync(NotificationType.CollectionItemCommentReceived)).Single(row => row.SubjectId == other).DispatchedAtUtc);
    }

    [Fact]
    public async Task CommentsInARow_AreOneNotification()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/chatty");

        for (var index = 0; index < 4; index++)
        {
            await _comments.CreateAsync(_member, _sharedId, link, $"comment {index}", null);
        }

        Assert.Single(await RowsAsync(NotificationType.CollectionItemCommentReceived));
    }

    [Fact]
    public async Task ReactionsAndComments_IgnoreThe새링크알림Setting_WhichIsOnlyAboutNewLinks()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/muted");
        await new CollectionNotificationPreferenceService(_access, new CollectionNotificationPreferenceStore(_db), TimeProvider.System)
            .SetAsync(_owner, _sharedId, false);
        _db.ChangeTracker.Clear();

        await _reactions.SetAsync(_member, _sharedId, link, "heart", null);
        await _comments.CreateAsync(_member, _sharedId, link, "hi", null);
        await Dispatcher().RunOnceAsync();

        Assert.Single(Sent(_owner, "collectionItemReaction"));
        Assert.Single(Sent(_owner, "collectionItemComment"));
    }

    // ---------- proposals ----------

    [Fact]
    public async Task AMembersProposal_TellsTheOwnerOnce_WithoutNamingThem_AndADuplicateOrAnApprovedOneIsNotPushed()
    {
        var item = await NewItemAsync(_submitter, "https://example.test/proposed");
        var duplicate = await NewItemAsync(_member, "https://example.test/proposed");
        var memberAdd = await NewItemAsync(_member, "https://example.test/direct");

        Assert.Equal(CollectionLinkAddOutcome.Submitted, await Add().AddAsync(_submitter, _sharedId, item));
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => SubmitAsMemberAsync(duplicate));
        Assert.Equal(CollectionLinkAddOutcome.Added, await Add().AddAsync(_member, _sharedId, memberAdd)); // a direct add is no proposal
        await Dispatcher().RunOnceAsync();

        var push = Assert.Single(Sent(_owner, "collectionLinkSubmission"));
        Assert.Equal(("승인 요청", "'여행'에 승인을 기다리는 새 링크가 있어요."), (push.Title, push.Body));
        Assert.DoesNotContain("파이리", push.Body);
        Assert.Equal(["collectionId"], push.Data.Keys);
        var row = Assert.Single(await RowsAsync(NotificationType.CollectionLinkSubmissionReceived));
        Assert.Null(row.ActorUserId); // who proposed is never stored with it

        // Approved before the Job ran: the request is no longer worth a push.
        var another = await NewItemAsync(_submitter, "https://example.test/approved-fast");
        await Add().AddAsync(_submitter, _sharedId, another);
        var waiting = await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == another);
        await Review().ApproveAsync(_owner, _sharedId, waiting.Id, null);
        _sender.Clear();
        await Dispatcher().RunOnceAsync();
        Assert.Empty(Sent(_owner, "collectionLinkSubmission"));
    }

    [Fact]
    public async Task ApprovalAndRejection_TellTheProposer_OnceEach_WithoutNamingTheOwner_AndOpenTheCollection()
    {
        var approvedItem = await NewItemAsync(_submitter, "https://example.test/yes");
        var rejectedItem = await NewItemAsync(_submitter, "https://example.test/no");
        await Add().AddAsync(_submitter, _sharedId, approvedItem);
        await Add().AddAsync(_submitter, _sharedId, rejectedItem);
        var toApprove = await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == approvedItem);
        var toReject = await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == rejectedItem);

        await Review().ApproveAsync(_owner, _sharedId, toApprove.Id, null);
        await Review().RejectAsync(_owner, _sharedId, toReject.Id, null);
        await Review().RejectAsync(_owner, _sharedId, toReject.Id, null); // twice: declined once
        await Dispatcher().RunOnceAsync();

        var approved = Assert.Single(Sent(_submitter, "collectionLinkSubmissionApproved"));
        Assert.Equal(("링크 승인", "'여행'에 보낸 링크가 승인됐어요."), (approved.Title, approved.Body));
        Assert.Equal(["collectionId"], approved.Data.Keys); // a member: the Collection itself
        var rejected = Assert.Single(Sent(_submitter, "collectionLinkSubmissionRejected"));
        Assert.Equal(("링크 미승인", "'여행'에 보낸 링크가 승인되지 않았어요."), (rejected.Title, rejected.Body));
        Assert.DoesNotContain("피카츄", approved.Body + rejected.Body);
        Assert.Empty(Sent(_owner, "collectionLinkSubmissionApproved"));
    }

    [Fact]
    public async Task ApprovalAndRejection_IgnoreThe새링크알림Setting()
    {
        await new CollectionNotificationPreferenceService(_access, new CollectionNotificationPreferenceStore(_db), TimeProvider.System)
            .SetAsync(_submitter, _sharedId, false);
        _db.ChangeTracker.Clear();
        var item = await NewItemAsync(_submitter, "https://example.test/muted-proposal");
        await Add().AddAsync(_submitter, _sharedId, item);
        var waiting = await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == item);

        await Review().RejectAsync(_owner, _sharedId, waiting.Id, null);
        await Dispatcher().RunOnceAsync();

        Assert.Single(Sent(_submitter, "collectionLinkSubmissionRejected"));
    }

    [Fact]
    public async Task APublicLinkProposal_IsAnonymousToTheOwner_AndItsResultReachesTheNonMember_ThroughThePublicLink()
    {
        // A Collection of its own with no Viewer, so the public link may take proposals.
        var publicCollection = (await _collections.CreateAsync(_owner, "공개함", "공개함", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        var shares = new EnableCollectionShareService(new CollectionShareStore(_db), TimeProvider.System);
        var share = await shares.EnableAsync(_owner, publicCollection, CollectionSharePermission.Submit);
        var outsider = await NewUserAsync();
        await RegisterDeviceAsync(outsider, "en");
        var first = await NewItemAsync(outsider, "https://example.test/public-1");
        var second = await NewItemAsync(outsider, "https://example.test/public-2");

        Assert.Equal(CollectionLinkAddOutcome.Submitted, await PublicAdd().AddItemAsync(outsider, share.PublicId, first, null));
        Assert.Equal(CollectionLinkAddOutcome.Submitted, await PublicAdd().AddItemAsync(outsider, share.PublicId, second, null));
        await Dispatcher().RunOnceAsync();
        var requests = Sent(_owner, "collectionLinkSubmission");
        Assert.Equal(2, requests.Count);
        Assert.All(requests, push => Assert.Equal("'공개함'에 승인을 기다리는 새 링크가 있어요.", push.Body));

        var firstWaiting = await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == first);
        var secondWaiting = await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == second);
        await Review().ApproveAsync(_owner, publicCollection, firstWaiting.Id, null);
        await Dispatcher().RunOnceAsync();

        // No member: the push opens the public link (its own id) - never the internal Collection id.
        var approved = Assert.Single(Sent(outsider, "collectionLinkSubmissionApproved"));
        Assert.Equal("The link you sent to \"공개함\" was approved.", approved.Body);
        Assert.Equal(["publicId"], approved.Data.Keys);
        Assert.Equal(share.PublicId, approved.Data["publicId"]);

        // The public link turned off meanwhile: the result still arrives, opening nothing in particular.
        await Review().RejectAsync(_owner, publicCollection, secondWaiting.Id, null);
        await new RevokeCollectionShareService(new CollectionShareStore(_db), TimeProvider.System).RevokeAsync(_owner, publicCollection);
        await Dispatcher().RunOnceAsync();
        var rejected = Assert.Single(Sent(outsider, "collectionLinkSubmissionRejected"));
        Assert.Empty(rejected.Data);
    }

    [Fact]
    public async Task ACancelledProposal_IsNeverPushedToTheOwner_WhetherItsEventOrItsNotificationWasStillWaiting()
    {
        var first = await NewItemAsync(_submitter, "https://example.test/cancel-before-event");
        var second = await NewItemAsync(_submitter, "https://example.test/cancel-before-send");
        var third = await NewItemAsync(_submitter, "https://example.test/stays");
        await Add().AddAsync(_submitter, _sharedId, first);
        var firstId = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == first)).Id;
        // Cancelled while its outbox EVENT is still unprocessed.
        await Cancel(firstId);

        await Add().AddAsync(_submitter, _sharedId, second);
        var secondId = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == second)).Id;
        Assert.Contains(secondId, (await RowsAsync(NotificationType.CollectionLinkSubmissionReceived)).Select(row => row.SubjectId!.Value));
        // Cancelled after its notification was MATERIALIZED (queued for delivery) but before anything was sent.
        await Cancel(secondId);

        await Add().AddAsync(_submitter, _sharedId, third);
        await Dispatcher().RunOnceAsync();

        // Only the proposal that still waits reaches the Owner; the requester is told nothing at all.
        Assert.Single(Sent(_owner, "collectionLinkSubmission"));
        var rows = await RowsAsync(NotificationType.CollectionLinkSubmissionReceived);
        var remaining = Assert.Single(rows);
        Assert.NotEqual(firstId, remaining.SubjectId);
        Assert.NotEqual(secondId, remaining.SubjectId);
        Assert.Empty(Sent(_submitter, "collectionLinkSubmissionRejected"));
        Assert.Empty(Sent(_submitter, "collectionLinkSubmissionApproved"));
    }

    [Fact]
    public async Task CancellingAnAlreadySentProposal_RemovesItsInboxRowAndUnread_TellsTheRequesterNothing_AndSendsOnlyARefresh()
    {
        var item = await NewItemAsync(_submitter, "https://example.test/cancel-after-send");
        await Add().AddAsync(_submitter, _sharedId, item);
        var id = (await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == item)).Id;
        await Dispatcher().RunOnceAsync();
        Assert.Single(Sent(_owner, "collectionLinkSubmission"));
        Assert.Equal(1, await new NotificationInboxStore(_db).CountUnreadAsync(_owner));
        _sender.Clear();

        await Cancel(id);
        await Dispatcher().RunOnceAsync();

        Assert.Empty(await RowsAsync(NotificationType.CollectionLinkSubmissionReceived));
        Assert.Equal(0, await new NotificationInboxStore(_db).CountUnreadAsync(_owner));
        Assert.Empty(await _db.NotificationDeliveries.AsNoTracking().Where(entry => !_db.Notifications.Any(row => row.Id == entry.NotificationId)).ToListAsync());
        // No result notification - this is not a rejection - and no tray notification for anyone: the
        // only message is the data-only refresh signal for the Collection.
        Assert.Empty(Sent(_submitter, "collectionLinkSubmissionRejected"));
        Assert.Empty(Sent(_owner, "collectionLinkSubmission"));
        Assert.Empty(_sender.SentTo(_owner).Where(sent => sent.Payload.Type != "collectionContentChanged" && sent.Payload.Type != "collectionLinkSubmission"));
    }

    private async Task Cancel(long submissionId)
    {
        await Review().CancelMineAsync(_submitter, submissionId, null);
        _db.ChangeTracker.Clear();
    }

    [Fact]
    public async Task AResultForADeletedCollection_IsNotPushed()
    {
        var item = await NewItemAsync(_submitter, "https://example.test/gone");
        await Add().AddAsync(_submitter, _sharedId, item);
        var waiting = await _db.CollectionLinkSubmissions.AsNoTracking().SingleAsync(entry => entry.ItemId == item);
        await Review().RejectAsync(_owner, _sharedId, waiting.Id, null);
        await _db.Collections.Where(entry => entry.Id == _sharedId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.DeletedAtUtc, DateTimeOffset.UtcNow));

        await Dispatcher().RunOnceAsync();

        Assert.Empty(Sent(_submitter, "collectionLinkSubmissionRejected"));
    }

    [Fact]
    public async Task DeletingTheActorsAccount_RemovesTheRowsTheyCaused()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/actor-gone");
        await _reactions.SetAsync(_member, _sharedId, link, "heart", null);
        await _comments.CreateAsync(_member, _sharedId, link, "bye", null);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_member, $"test/{_member}/", DateTimeOffset.UtcNow);

        Assert.Empty(await RowsAsync(NotificationType.CollectionItemReactionReceived));
        Assert.Empty(await RowsAsync(NotificationType.CollectionItemCommentReceived));
    }

    // ---------- helpers ----------

    private DispatchPendingPushNotificationsService Dispatcher() =>
        Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.Dispatcher(_db, _sender);

    private AddItemToCollectionService Add() =>
        new(_access, _collections, TimeProvider.System, _publisher, new CollectionLinkSubmissionStore(_db));

    private PublicCollectionWriteService PublicAdd() =>
        new(new PublicCollectionStore(_db), _collections, _tokens, TimeProvider.System, _publisher, new CollectionLinkSubmissionStore(_db));

    private CollectionLinkSubmissionService Review() =>
        new(_access, new CollectionLinkSubmissionStore(_db), TimeProvider.System, _publisher);

    /// <summary>A proposal by a member whose role allows only proposing - for the duplicate case.</summary>
    private async Task SubmitAsMemberAsync(long itemId)
    {
        await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _sharedId && entry.UserId == _member)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Submitter));
        try
        {
            await Add().AddAsync(_member, _sharedId, itemId);
        }
        finally
        {
            await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _sharedId && entry.UserId == _member)
                .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Contributor));
        }
    }

    private async Task<long> AddLinkAsync(long userId, string url)
    {
        var item = await NewItemAsync(userId, url);
        Assert.Equal(CollectionLinkAddOutcome.Added, await Add().AddAsync(userId, _sharedId, item));
        _db.ChangeTracker.Clear();
        return item;
    }

    /// <summary>Moves this test's coalesced rows out of the current window, as if a minute had passed.</summary>
    private async Task AgeCollaborationRowsAsync()
    {
        // Both coalescing levels: the outbox event and the recipient's notification.
        await _db.NotificationEvents
            .Where(entry => entry.CollectionId == _sharedId
                && (entry.Type == NotificationType.CollectionItemReactionReceived || entry.Type == NotificationType.CollectionItemCommentReceived))
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.DedupKey, entry => entry.DedupKey + ":aged"));
        await _db.Notifications
            .Where(entry => entry.CollectionId == _sharedId
                && (entry.Type == NotificationType.CollectionItemReactionReceived || entry.Type == NotificationType.CollectionItemCommentReceived))
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.DedupKey, entry => entry.DedupKey + ":aged"));
    }

    /// <summary>This test's users' notifications of the type - after the recorded outbox has been materialized.</summary>
    private async Task<List<Notification>> RowsAsync(NotificationType type)
    {
        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        return await _db.Notifications.AsNoTracking()
            .Where(entry => entry.Type == type && _userIds.Contains(entry.UserId))
            .ToListAsync();
    }

    private IReadOnlyList<PushNotificationPayload> Sent(long userId, string type) =>
        _sender.SentTo(userId).Where(sent => sent.Payload.Type == type).Select(sent => sent.Payload).ToList();

    private async Task InviteAndAcceptAsync(long collectionId, long inviteeId, CollectionCollaboratorRole role)
    {
        var invitation = await _collaboration.InviteAsync(_owner, collectionId, await JupleIdOfAsync(inviteeId), role);
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
        _db.ChangeTracker.Clear();
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task RegisterDeviceAsync(long userId, string locale)
    {
        await new PushDeviceRegistrationStore(_db).RegisterAsync(
            userId, PushPlatform.Android, Guid.NewGuid().ToString("N"), "test-token-" + Guid.NewGuid().ToString("N"), locale, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private sealed class RecordingPushSender : IPushSender
    {
        private readonly List<(long UserId, PushNotificationPayload Payload)> _sent = [];

        public IReadOnlyList<(long UserId, PushNotificationPayload Payload)> All => _sent;

        public IReadOnlyList<(long UserId, PushNotificationPayload Payload)> SentTo(long userId) =>
            _sent.Where(sent => sent.UserId == userId).ToList();

        public void Clear() => _sent.Clear();

        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            _sent.Add((device.UserId, payload));
            return Task.FromResult(PushSendResult.Sent("test-message"));
        }
    }
}
