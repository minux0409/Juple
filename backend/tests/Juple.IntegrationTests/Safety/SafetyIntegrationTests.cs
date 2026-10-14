using Juple.Application.Collections;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Friends;
using Juple.Application.Safety;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Safety;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Friends;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Safety;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.IntegrationTests.Safety;

/// <summary>
/// Terms consent, reporting and blocking against the real schema: the rules that keep user-generated content accountable
/// (Google Play UGC policy) - who may report what, that a block really stops interaction in both directions, that it never reveals
/// itself to the blocked person, and that account deletion leaves no block behind but keeps reports as anonymous evidence.
/// </summary>
public sealed class SafetyIntegrationTests : IAsyncLifetime
{
    private const string CurrentTerms = "2026-10-14";

    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run the safety integration tests.");
        _db = NewContext();
        await Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        await _db.NotificationEvents.Where(entry => entry.ActorUserId != null && _userIds.Contains(entry.ActorUserId.Value)).ExecuteDeleteAsync();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/safety/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.ContentReports.Where(report => report.Details != null && report.Details.StartsWith("[safety-test]")).ExecuteDeleteAsync();
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/safety/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task<(long Id, string JupleId)> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return (user.Id, user.PublicCode);
    }

    private TermsConsentService Terms(string? version = null, bool enforce = true) =>
        new(new SafetyStore(NewContext()), new TermsOptions { CurrentVersion = version ?? CurrentTerms, EnforceAcceptance = enforce }, TimeProvider.System);

    private ReportService Reports() => new(new SafetyStore(NewContext()), TimeProvider.System);

    private UserBlockService Blocks() => new(new UserDirectoryStore(NewContext()), new SafetyStore(NewContext()), TimeProvider.System);

    private FriendService Friends() =>
        new(new UserDirectoryStore(NewContext()), new FriendStore(NewContext()), TimeProvider.System, null, new UserBlockPolicy(new SafetyStore(NewContext())));

    private async Task<long> NewCollectionAsync(long owner, params long[] members)
    {
        var collection = await new CollectionStore(_db).CreateAsync(owner, "Safety " + Guid.NewGuid().ToString("N")[..8], Guid.NewGuid().ToString("N"), CollectionIcon.Folder, DateTimeOffset.UtcNow);
        foreach (var member in members)
        {
            _db.CollectionCollaborators.Add(new CollectionCollaborator(collection.Id, member, CollectionCollaboratorRole.Contributor, owner, DateTimeOffset.UtcNow));
        }

        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        return collection.Id;
    }

    private async Task<long> NewItemInAsync(long userId, long collectionId)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, "https://example.test/" + Guid.NewGuid().ToString("N"), null, DateTimeOffset.UtcNow);
        await new CollectionStore(_db).AddAsync(userId, collectionId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    // ---------- terms ----------

    [Fact]
    public async Task Terms_NoAcceptance_IsRefused_AndAcceptingTheCurrentVersionAllows()
    {
        var (user, _) = await NewUserAsync();

        await Assert.ThrowsAsync<TermsAcceptanceRequiredException>(() => Terms().RequireAcceptedAsync(user));
        var status = await Terms().GetStatusAsync(user);
        Assert.False(status.IsAccepted);
        Assert.Equal(CurrentTerms, status.CurrentVersion);
        Assert.Null(status.AcceptedVersion);

        var accepted = await Terms().AcceptAsync(user, CurrentTerms);
        Assert.True(accepted.IsAccepted);
        await Terms().RequireAcceptedAsync(user);
        Assert.True((await Terms().GetStatusAsync(user)).IsAccepted);
    }

    [Fact]
    public async Task Terms_AnOlderAcceptedVersion_IsNotEnough_AndAnInventedVersionIsNeverRecorded()
    {
        var (user, _) = await NewUserAsync();
        await Terms(version: "2025-01-01").AcceptAsync(user, "2025-01-01");

        // The current version is newer: the old agreement does not count.
        await Assert.ThrowsAsync<TermsAcceptanceRequiredException>(() => Terms().RequireAcceptedAsync(user));
        await Assert.ThrowsAsync<InvalidTermsVersionException>(() => Terms().AcceptAsync(user, "2024-01-01"));
        await Assert.ThrowsAsync<InvalidTermsVersionException>(() => Terms().AcceptAsync(user, null));

        await Terms().AcceptAsync(user, CurrentTerms);
        await Terms().RequireAcceptedAsync(user);
    }

    [Fact]
    public async Task Terms_AcceptingTwice_KeepsTheFirstTime_AndTheRolloutSwitchOnlyRelaxesTheGate()
    {
        var (user, _) = await NewUserAsync();
        var first = await Terms().AcceptAsync(user, CurrentTerms);
        await Task.Delay(20);
        var second = await Terms().AcceptAsync(user, CurrentTerms);
        Assert.Equal(first.AcceptedAtUtc, second.AcceptedAtUtc);

        var (other, _) = await NewUserAsync();
        await Terms(enforce: false).RequireAcceptedAsync(other);
        Assert.False((await Terms(enforce: false).GetStatusAsync(other)).IsAccepted);
    }

    // ---------- reports ----------

    [Fact]
    public async Task Report_AUserYouShareACollectionWith_IsStored_AndTheSecondOpenReportIsTheSame()
    {
        var (reporter, _) = await NewUserAsync();
        var (target, targetCode) = await NewUserAsync();
        await NewCollectionAsync(reporter, target);

        var first = await Reports().CreateAsync(reporter, new CreateReportCommand("User", targetCode, null, "Harassment", "[safety-test] rude"));
        var second = await Reports().CreateAsync(reporter, new CreateReportCommand("User", targetCode, null, "Spam", "[safety-test] again"));

        Assert.False(first.AlreadyReported);
        Assert.True(second.AlreadyReported);
        var row = await NewContext().ContentReports.AsNoTracking().SingleAsync(report => report.ReporterUserId == reporter && report.TargetId == target);
        Assert.Equal(ReportTargetType.User, row.TargetType);
        Assert.Equal(target, row.TargetUserId);
        Assert.Equal(ReportReason.Harassment, row.Reason);
        Assert.Equal(ReportStatus.Pending, row.Status);
    }

    [Fact]
    public async Task Report_AStranger_IsNotFound_AndNeverRevealsWhoExists()
    {
        var (reporter, _) = await NewUserAsync();
        var (_, strangerCode) = await NewUserAsync();

        await Assert.ThrowsAsync<ReportTargetNotFoundException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("User", strangerCode, null, "Spam", null)));
        await Assert.ThrowsAsync<ReportTargetNotFoundException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("User", "ZZZZZZZZ", null, "Spam", null)));
        Assert.False(await NewContext().ContentReports.AnyAsync(report => report.ReporterUserId == reporter));
    }

    [Fact]
    public async Task Report_Yourself_AndYourOwnContent_AreRefused()
    {
        var (me, myCode) = await NewUserAsync();
        var (other, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(me, other);
        var item = await NewItemInAsync(me, collection);

        await Assert.ThrowsAsync<ReportOwnContentException>(() => Reports().CreateAsync(me, new CreateReportCommand("User", myCode, null, "Spam", null)));
        await Assert.ThrowsAsync<ReportOwnContentException>(() => Reports().CreateAsync(me, new CreateReportCommand("Collection", collection.ToString(), null, "Spam", null)));
        await Assert.ThrowsAsync<ReportOwnContentException>(() => Reports().CreateAsync(me, new CreateReportCommand("Item", item.ToString(), collection, "Spam", null)));
    }

    [Fact]
    public async Task Report_ACollection_AnItem_AndAComment_NeedAccessToTheCollection()
    {
        var (owner, _) = await NewUserAsync();
        var (member, _) = await NewUserAsync();
        var (outsider, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);
        var item = await NewItemInAsync(owner, collection);
        var comment = (await new CollectionItemCommentStore(NewContext()).CreateAsync(owner, collection, item, "hello", DateTimeOffset.UtcNow))!.Comment.Id;

        Assert.False((await Reports().CreateAsync(member, new CreateReportCommand("Collection", collection.ToString(), null, "Illegal", "[safety-test] c"))).AlreadyReported);
        Assert.False((await Reports().CreateAsync(member, new CreateReportCommand("Item", item.ToString(), collection, "ScamOrMaliciousLink", "[safety-test] i"))).AlreadyReported);
        Assert.False((await Reports().CreateAsync(member, new CreateReportCommand("Comment", comment.ToString(), null, "HateOrAbuse", "[safety-test] m"))).AlreadyReported);

        var stored = await NewContext().ContentReports.AsNoTracking().Where(report => report.ReporterUserId == member).ToListAsync();
        Assert.Equal(3, stored.Count);
        Assert.All(stored, report => Assert.Equal(owner, report.TargetUserId));
        Assert.Equal(collection, stored.Single(report => report.TargetType == ReportTargetType.Comment).CollectionId);

        // Somebody who cannot see the Collection gets the same "not found" for all three - ids reveal nothing.
        foreach (var command in new[]
        {
            new CreateReportCommand("Collection", collection.ToString(), null, "Spam", null),
            new CreateReportCommand("Item", item.ToString(), collection, "Spam", null),
            new CreateReportCommand("Comment", comment.ToString(), null, "Spam", null),
        })
        {
            await Assert.ThrowsAsync<ReportTargetNotFoundException>(() => Reports().CreateAsync(outsider, command));
        }

        // An Item is only reported THROUGH a Collection that holds it.
        await Assert.ThrowsAsync<ReportTargetNotFoundException>(() => Reports().CreateAsync(member, new CreateReportCommand("Item", item.ToString(), null, "Spam", null)));
        await Assert.ThrowsAsync<ReportTargetNotFoundException>(() => Reports().CreateAsync(member, new CreateReportCommand("Collection", "999999999", null, "Spam", null)));
    }

    [Fact]
    public async Task Report_ValidatesTheRequest()
    {
        var (reporter, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(reporter);

        await Assert.ThrowsAsync<InvalidReportException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("Nope", "1", null, "Spam", null)));
        await Assert.ThrowsAsync<InvalidReportException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("collection", "1", null, "Spam", null)));
        await Assert.ThrowsAsync<InvalidReportException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("Collection", collection.ToString(), null, "spam", null)));
        await Assert.ThrowsAsync<InvalidReportException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("Collection", "abc", null, "Spam", null)));
        await Assert.ThrowsAsync<InvalidReportException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("Collection", "-4", null, "Spam", null)));
        await Assert.ThrowsAsync<InvalidReportException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("Collection", "1", null, "Spam", new string('x', ContentReport.DetailsMaxLength + 1))));
        await Assert.ThrowsAsync<InvalidReportException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("Collection", "1", null, "Spam", "bad\u0007text")));
        await Assert.ThrowsAsync<InvalidReportException>(() => Reports().CreateAsync(reporter, new CreateReportCommand("Collection", "1", 0, "Spam", null)));
    }

    [Fact]
    public async Task Report_DetailsAreStoredAsPlainBoundedText()
    {
        var (reporter, _) = await NewUserAsync();
        var (target, code) = await NewUserAsync();
        await NewCollectionAsync(reporter, target);

        await Reports().CreateAsync(reporter, new CreateReportCommand("User", code, null, "Other", "  [safety-test] <script>alert(1)</script>\nline two  "));

        var details = await NewContext().ContentReports.AsNoTracking().Where(report => report.ReporterUserId == reporter).Select(report => report.Details).SingleAsync();
        Assert.Equal("[safety-test] <script>alert(1)</script>\nline two", details);
    }

    // ---------- blocks ----------

    [Fact]
    public async Task Block_IsIdempotent_Unblocks_AndRefusesBlockingYourself()
    {
        var (me, myCode) = await NewUserAsync();
        var (other, otherCode) = await NewUserAsync();

        await Blocks().BlockAsync(me, otherCode);
        await Blocks().BlockAsync(me, otherCode);
        Assert.Equal(1, await NewContext().UserBlocks.CountAsync(block => block.BlockerUserId == me && block.BlockedUserId == other));
        Assert.Equal([otherCode], (await Blocks().ListAsync(me)).Select(blocked => blocked.JupleId));
        Assert.Empty(await Blocks().ListAsync(other));

        await Blocks().UnblockAsync(me, otherCode);
        await Blocks().UnblockAsync(me, otherCode);
        Assert.Empty(await Blocks().ListAsync(me));

        await Assert.ThrowsAsync<InvalidBlockException>(() => Blocks().BlockAsync(me, myCode));
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => Blocks().BlockAsync(me, "ZZZZZZZZ"));
    }

    [Fact]
    public async Task Block_EndsAFriendship_AndFriendRequestsAreRefusedInBothDirections_UntilUnblocked()
    {
        var (a, aCode) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();

        var request = await Friends().SendRequestAsync(a, bCode);
        await Friends().AcceptAsync(b, request.RequestId);
        Assert.True(await NewContext().Friendships.AnyAsync(friendship => friendship.UserLowId == Math.Min(a, b) && friendship.UserHighId == Math.Max(a, b)));

        await Blocks().BlockAsync(a, bCode);
        Assert.False(await NewContext().Friendships.AnyAsync(friendship => friendship.UserLowId == Math.Min(a, b) && friendship.UserHighId == Math.Max(a, b)));

        var byBlocker = await Assert.ThrowsAsync<UserBlockedException>(() => Friends().SendRequestAsync(a, bCode));
        Assert.True(byBlocker.BlockedByCaller);
        var byBlocked = await Assert.ThrowsAsync<UserBlockedException>(() => Friends().SendRequestAsync(b, aCode));
        Assert.False(byBlocked.BlockedByCaller);

        // Unblocking does not make them friends again, but a new request is possible.
        await Blocks().UnblockAsync(a, bCode);
        Assert.False(await NewContext().Friendships.AnyAsync(friendship => friendship.UserLowId == Math.Min(a, b) && friendship.UserHighId == Math.Max(a, b)));
        var again = await Friends().SendRequestAsync(b, aCode);
        Assert.True(again.RequestId > 0);
    }

    [Fact]
    public async Task Block_RemovesAPendingFriendRequest()
    {
        var (a, _) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        await Friends().SendRequestAsync(a, bCode);

        await Blocks().BlockAsync(b, (await NewContext().Users.AsNoTracking().SingleAsync(user => user.Id == a)).PublicCode);

        Assert.False(await NewContext().Friendships.AnyAsync(friendship => friendship.UserLowId == Math.Min(a, b) && friendship.UserHighId == Math.Max(a, b)));
    }

    [Fact]
    public async Task Block_StopsInvitations_InBothDirections_AndALaterAcceptance()
    {
        var (owner, ownerCode) = await NewUserAsync();
        var (guest, guestCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner);
        var store = () => new CollectionCollaborationStore(NewContext());

        var invitation = await store().CreateInvitationAsync(collection, owner, guest, DateTimeOffset.UtcNow);
        await Blocks().BlockAsync(guest, ownerCode);

        // Accepting a pending invitation across a block is refused too.
        await Assert.ThrowsAsync<UserBlockedException>(() => store().AcceptAsync(guest, invitation.InvitationId, DateTimeOffset.UtcNow));
        await Blocks().UnblockAsync(guest, ownerCode);

        await Blocks().BlockAsync(owner, guestCode);
        var (third, _) = await NewUserAsync();
        await store().CreateInvitationAsync(collection, owner, third, DateTimeOffset.UtcNow);
        await Assert.ThrowsAsync<UserBlockedException>(() => store().CreateInvitationAsync(collection, owner, guest, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task Block_StopsComments_Replies_Hearts_AndReactions_ButNeverDeletesAnyone_sContent()
    {
        var (owner, ownerCode) = await NewUserAsync();
        var (member, memberCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);
        var item = await NewItemInAsync(owner, collection);
        var comments = () => new CollectionItemCommentStore(NewContext());

        var existing = (await comments().CreateAsync(member, collection, item, "from the member", DateTimeOffset.UtcNow))!.Comment.Id;
        await Blocks().BlockAsync(owner, memberCode);

        // Neither direction may comment on, answer, heart or react to the other any more...
        await Assert.ThrowsAsync<UserBlockedException>(() => comments().CreateAsync(member, collection, item, "top-level", DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<UserBlockedException>(() => comments().CreateAsync(owner, collection, item, "an answer", DateTimeOffset.UtcNow, existing));
        await Assert.ThrowsAsync<UserBlockedException>(() => comments().SetLikeAsync(owner, collection, item, existing, true, DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<UserBlockedException>(() => new CollectionItemReactionStore(NewContext()).SetAsync(member, collection, item, "heart", DateTimeOffset.UtcNow));

        // ... taking a heart back stays possible, the member keeps their membership and their words exist.
        await comments().SetLikeAsync(owner, collection, item, existing, false, DateTimeOffset.UtcNow);
        Assert.True(await NewContext().CollectionCollaborators.AnyAsync(entry => entry.CollectionId == collection && entry.UserId == member));
        Assert.True(await NewContext().CollectionItemComments.AnyAsync(entry => entry.Id == existing && entry.DeletedAtUtc == null));

        // The blocker no longer sees the blocked person's words; the blocked person (and everybody else) still do.
        Assert.Equal(0, (await comments().GetPageAsync(owner, collection, item, null, 30))!.TotalCount);
        Assert.Equal(1, (await comments().GetPageAsync(member, collection, item, null, 30))!.TotalCount);

        // After unblocking the interaction works again.
        await Blocks().UnblockAsync(owner, memberCode);
        Assert.NotNull(await comments().CreateAsync(member, collection, item, "back again", DateTimeOffset.UtcNow));
        Assert.Equal(2, (await comments().GetPageAsync(owner, collection, item, null, 30))!.TotalCount);
        _ = ownerCode;
    }

    [Fact]
    public async Task Block_FindsNobodyByJupleId_OnEitherSide()
    {
        var (a, aCode) = await NewUserAsync();
        var (b, bCode) = await NewUserAsync();
        var service = new CollectionCollaborationService(
            null!, new UserDirectoryStore(NewContext()), null!, TimeProvider.System, null, null, new UserBlockPolicy(new SafetyStore(NewContext())));

        Assert.Equal(bCode, (await service.LookupAsync(a, bCode)).JupleId);
        await Blocks().BlockAsync(a, bCode);

        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => service.LookupAsync(a, bCode));
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => service.LookupAsync(b, aCode));
    }

    // ---------- notifications ----------

    [Fact]
    public async Task Block_NoNotificationsAreMaterialized_BetweenBlockedPeople_EvenForEventsQueuedBeforeTheBlock()
    {
        var (owner, _) = await NewUserAsync();
        var (member, memberCode) = await NewUserAsync();
        var (bystander, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member, bystander);

        // Two events are queued while everybody is on good terms: the member adds links (everyone else is told) and sends a friend request.
        var publisher = new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance);
        await publisher.CollectionItemsAddedAsync(member, collection, 1, hideActor: false);
        await publisher.FriendRequestReceivedAsync(member, owner, 12345, default);

        // ... then the owner blocks the member before the worker runs.
        await Blocks().BlockAsync(owner, memberCode);
        await NotificationPipelineTestKit.MaterializeOutboxAsync(_db);

        var told = await NewContext().Notifications.AsNoTracking().Where(notification => notification.ActorUserId == member).Select(notification => notification.UserId).ToListAsync();
        Assert.DoesNotContain(owner, told);
        Assert.Contains(bystander, told);
        Assert.DoesNotContain(await NewContext().Notifications.AsNoTracking().Where(notification => notification.UserId == owner && notification.Type == NotificationType.FriendRequestReceived).ToListAsync(), _ => true);
    }

    // ---------- account deletion ----------

    [Fact]
    public async Task AccountDeletion_RemovesBlocks_KeepsReportsAnonymously_AndDeletesTheTermsWithTheAccount()
    {
        var (reporter, _) = await NewUserAsync();
        var (target, targetCode) = await NewUserAsync();
        await NewCollectionAsync(reporter, target);
        await Terms().AcceptAsync(reporter, CurrentTerms);
        await Reports().CreateAsync(reporter, new CreateReportCommand("User", targetCode, null, "Illegal", "[safety-test] keep me"));
        await Blocks().BlockAsync(reporter, targetCode);

        await new AccountDeletionStore(NewContext()).DeleteAllDataAsync(reporter, $"test/safety/{reporter}/", DateTimeOffset.UtcNow);

        Assert.False(await NewContext().UserBlocks.AnyAsync(block => block.BlockerUserId == reporter || block.BlockedUserId == reporter));
        Assert.False(await NewContext().Users.AnyAsync(user => user.Id == reporter));
        var report = await NewContext().ContentReports.AsNoTracking().SingleAsync(entry => entry.Details == "[safety-test] keep me");
        Assert.Null(report.ReporterUserId);
        Assert.Equal(target, report.TargetUserId);

        // The reported person's deletion clears the person from the report as well; the report itself stays.
        await new AccountDeletionStore(NewContext()).DeleteAllDataAsync(target, $"test/safety/{target}/", DateTimeOffset.UtcNow);
        var afterTarget = await NewContext().ContentReports.AsNoTracking().SingleAsync(entry => entry.Details == "[safety-test] keep me");
        Assert.Null(afterTarget.TargetUserId);
    }
}
