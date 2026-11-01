using Juple.Application.Admin;
using Juple.Application.Images;
using Juple.Application.Items.GetItemHistory;
using Juple.Application.Items.GetItemTrash;
using Xunit.Abstractions;
using Juple.Application.Notifications.Inbox;
using Juple.Application.Safety;
using Juple.Domain.Admin;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Safety;
using Juple.Domain.Users;
using Juple.Infrastructure.Admin;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Safety;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Safety;

/// <summary>
/// An operator ACTION is itself what notifies the person it changed: deleting / restoring a link, restricting / lifting its sharing, restricting /
/// lifting an account each write a notice (a snapshot: what, to what, the reason code, the operator's reviewed message) and its Inbox row in the SAME
/// transaction as the action. The notice stays readable after the content is soft-deleted, confirming it never removes it, the same action is never
/// noticed twice, only the recipient can read it, and nothing of the reporter reaches it.
/// </summary>
public sealed class AdminActionNoticesIntegrationTests : IAsyncLifetime
{
    private const string ReporterNote = "REPORTER-PRIVATE-EXPLANATION";

    private readonly ITestOutputHelper _output;

    public AdminActionNoticesIntegrationTests(ITestOutputHelper output) => _output = output;

    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private readonly List<long> _collectionIds = [];

    public Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run these integration tests.");
        _db = NewContext();
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        await _db.ShareRestrictions.Where(restriction => _collectionIds.Contains(restriction.CollectionId)).ExecuteDeleteAsync();
        await _db.ContentReports.Where(report => (report.ReporterUserId != null && _userIds.Contains(report.ReporterUserId.Value))
            || (report.TargetUserId != null && _userIds.Contains(report.TargetUserId.Value))).ExecuteDeleteAsync();
        await _db.AdminAuditLogs.Where(log => _userIds.Contains(log.AdminUserId)).ExecuteDeleteAsync();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/actionnotice/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/actionnotice/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task<(long Id, string JupleId)> NewUserAsync()
    {
        var user = new User("ko-KR", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return (user.Id, user.PublicCode);
    }

    private async Task<long> NewCollectionAsync(long owner, params long[] members)
    {
        var collection = await new CollectionStore(_db).CreateAsync(owner, "ActionNotice " + Guid.NewGuid().ToString("N")[..8], Guid.NewGuid().ToString("N"), CollectionIcon.Folder, DateTimeOffset.UtcNow, null);
        foreach (var member in members)
        {
            _db.CollectionCollaborators.Add(new CollectionCollaborator(collection.Id, member, CollectionCollaboratorRole.Contributor, owner, DateTimeOffset.UtcNow));
        }

        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        _collectionIds.Add(collection.Id);
        return collection.Id;
    }

    private async Task<long> NewLinkAsync(long userId, long collectionId)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, "https://example.test/" + Guid.NewGuid().ToString("N"), null, DateTimeOffset.UtcNow);
        await new CollectionStore(_db).AddAsync(userId, collectionId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private AdminReportService Admin() => new(new AdminReportStore(NewContext()), TimeProvider.System);

    private ModerationNoticeStore Notices() => new(NewContext());

    private async Task<long> ReportLinkAsync(long reporter, long link, long collection)
    {
        await new ReportService(new SafetyStore(NewContext()), TimeProvider.System)
            .CreateAsync(reporter, new CreateReportCommand("Item", link.ToString(), collection, "Harassment", ReporterNote));
        return await NewContext().ContentReports.Where(report => report.ReporterUserId == reporter && report.TargetType == ReportTargetType.Item && report.TargetId == link).Select(report => report.Id).FirstAsync();
    }

    private Task<List<ModerationNotice>> ActionNoticesAsync(long recipient, ModerationActionType? type = null) =>
        NewContext().ModerationNotices.AsNoTracking()
            .Where(notice => notice.RecipientUserId == recipient && notice.Kind == ModerationNoticeKind.Action && (type == null || notice.ActionType == type))
            .OrderBy(notice => notice.Id).ToListAsync();

    [Fact]
    public async Task DeletingAReportedLink_NoticesTheAuthor_ReadableAfterTheDeletion_Confirmed_ReReadable_AndNeverTwice()
    {
        var (author, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(author, reporter);
        var link = await NewLinkAsync(author, collection);
        var report = await ReportLinkAsync(reporter, link, collection);

        // The operator sees the evidence without being a member of the Collection: the report carries the link, the owner and the Collection.
        var before = await Admin().GetAsync(report);
        Assert.False(await NewContext().CollectionCollaborators.AnyAsync(member => member.CollectionId == collection && member.UserId == admin));
        Assert.StartsWith("https://example.test/", before.SnapshotUrl);
        Assert.NotNull(before.CollectionName);
        Assert.Empty(before.Notices);

        var after = await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, "internal note", "운영정책에 따라 삭제했습니다.");
        Assert.True(after.TargetDeleted);

        // The action and its notice are one transaction: the Collection's link is gone (the saved link itself is not) AND the author has the notice and its Inbox row.
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
        Assert.False(await NewContext().CollectionItems.AnyAsync(entry => entry.CollectionId == collection && entry.ItemId == link));
        var notice = Assert.Single(await ActionNoticesAsync(author));
        Assert.Equal(ModerationActionType.ContentRemovedFromCollection, notice.ActionType);
        Assert.Equal("Item", notice.ContentType);
        Assert.Equal("example.test", notice.ContentTitle);
        Assert.Equal("Harassment", notice.ReasonCode);
        Assert.Equal("운영정책에 따라 삭제했습니다.", notice.Guidance);
        var row = await NewContext().Notifications.SingleAsync(entry => entry.UserId == author && entry.SubjectId == notice.Id);
        Assert.Equal(NotificationType.AdminWarning, row.Type);
        Assert.Null(row.DispatchedAtUtc);
        Assert.Contains(row.Id, (await new PushDispatchStore(NewContext()).ListPendingAsync(1000, DateTimeOffset.UtcNow.AddMinutes(1))).Select(entry => entry.Id));

        // The notice opens although its link is deleted; its target is the notice, never the link. The internal note and the reporter stay out of it.
        var inbox = Assert.Single(await new NotificationInboxStore(NewContext()).ListAsync(author, null, 20, DateTimeOffset.UtcNow), record => record.SubjectId == notice.Id);
        Assert.Equal(NotificationTargetKinds.ModerationNotice, NotificationInboxPolicy.ResolveTarget(inbox).Kind);
        var read = (await Notices().GetAsync(author, notice.Id))!;
        Assert.Equal("action", read.Kind);
        Assert.Equal("contentRemovedFromCollection", read.ActionType);
        Assert.Equal("example.test", read.ContentTitle);
        Assert.DoesNotContain(ReporterNote, read.Guidance + read.Reason + read.ContentTitle);
        Assert.DoesNotContain("internal note", read.Guidance);
        Assert.Single(await Notices().ListUnacknowledgedAsync(author, 10));

        // Only the recipient: the reporter and the operator cannot open the person's notice.
        Assert.Null(await Notices().GetAsync(reporter, notice.Id));
        Assert.Null(await Notices().GetAsync(admin, notice.Id));
        Assert.False(await Notices().AcknowledgeAsync(reporter, notice.Id, DateTimeOffset.UtcNow));

        // Confirming reads it and takes it out of the pop-up list - and nothing else: it can be opened again, with everything in it.
        Assert.True(await Notices().AcknowledgeAsync(author, notice.Id, DateTimeOffset.UtcNow));
        Assert.True(await Notices().AcknowledgeAsync(author, notice.Id, DateTimeOffset.UtcNow));
        Assert.Empty(await Notices().ListUnacknowledgedAsync(author, 10));
        var again = (await Notices().GetAsync(author, notice.Id))!;
        Assert.NotNull(again.AcknowledgedAtUtc);
        Assert.Equal("example.test", again.ContentTitle);
        Assert.Equal("운영정책에 따라 삭제했습니다.", again.Guidance);
        Assert.NotNull((await NewContext().Notifications.SingleAsync(entry => entry.Id == row.Id)).ReadAtUtc);
        Assert.Contains(await new NotificationInboxStore(NewContext()).ListAsync(author, null, 20, DateTimeOffset.UtcNow), record => record.SubjectId == notice.Id);

        // The same action again (a reopened report, a second click) notices nothing new; a different action - the restore - is noticed on its own.
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null);
        Assert.Single(await ActionNoticesAsync(author, ModerationActionType.ContentRemovedFromCollection));
        await Admin().RestoreTargetAsync(admin, isOwner: true, report, null, "복구했습니다.");
        Assert.Single(await ActionNoticesAsync(author, ModerationActionType.ContentRestored));
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null);
        Assert.Equal(2, (await ActionNoticesAsync(author, ModerationActionType.ContentRemovedFromCollection)).Count);
        Assert.Equal(1, await NewContext().AdminAuditLogs.CountAsync(log => log.Action == AdminAuditActions.ContentRestored && log.TargetId == report.ToString()));

        // The report's own view for the operator: what was sent, when, and whether it was confirmed.
        var detail = await Admin().GetAsync(report);
        Assert.Equal(3, detail.Notices.Count); // deleted, restored, deleted again - the repeated click in between noticed nothing
        Assert.Contains(detail.Notices, entry => entry.ActionType == nameof(ModerationActionType.ContentRemovedFromCollection) && entry.AcknowledgedAtUtc != null);
        Assert.Contains(detail.Notices, entry => entry.ActionType == nameof(ModerationActionType.ContentRestored) && entry.AcknowledgedAtUtc == null);
    }

    private async Task<long> TwoCollectionLinkAsync(long author, long owner, long reporter)
    {
        var collectionA = await NewCollectionAsync(owner, author, reporter);
        var collectionB = await NewCollectionAsync(author);
        var link = await NewLinkAsync(author, collectionA);
        await new CollectionStore(NewContext()).AddAsync(author, collectionB, link, DateTimeOffset.UtcNow);
        _collectionPair = (collectionA, collectionB);
        return link;
    }

    private (long A, long B) _collectionPair;

    [Fact]
    public async Task RemovingAReportedLink_TakesOnlyTheReportedCollectionsLink_AndNeverTheSavedLinkOrItsOtherPlaces()
    {
        var (author, _) = await NewUserAsync();
        var (owner, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var link = await TwoCollectionLinkAsync(author, owner, reporter);
        var (collectionA, collectionB) = _collectionPair;
        var report = await ReportLinkAsync(reporter, link, collectionA);

        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, "internal", "message");

        await using var db = NewContext();
        Assert.True(await db.Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
        Assert.Equal(author, await db.Items.Where(item => item.Id == link).Select(item => item.UserId).SingleAsync());
        Assert.False(await db.CollectionItems.AnyAsync(entry => entry.CollectionId == collectionA && entry.ItemId == link));
        Assert.True(await db.CollectionItems.AnyAsync(entry => entry.CollectionId == collectionB && entry.ItemId == link));
        Assert.Contains(link, (await new CollectionStore(NewContext()).GetItemsAsync(author, collectionB, null, 50)).Page.Items.Select(entry => entry.ItemId));
    }

    [Fact]
    public async Task RemovingAReportedLink_NoticesTheOneWhoAddedIt_WithTheSnapshotAndTheOperatorsMessage_NeverTheReporter()
    {
        var (author, _) = await NewUserAsync();
        var (owner, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var link = await TwoCollectionLinkAsync(author, owner, reporter);
        var (collectionA, _) = _collectionPair;
        await using (var db = NewContext())
        {
            var item = await db.Items.SingleAsync(candidate => candidate.Id == link);
            item.UpdateDetails("신고된 링크 제목", null);
            item.SetPreviewImageUrl("https://img.example.test/a.jpg");
            await db.SaveChangesAsync();
        }

        var collectionName = await NewContext().Collections.Where(candidate => candidate.Id == collectionA).Select(candidate => candidate.Name).SingleAsync();
        var report = await ReportLinkAsync(reporter, link, collectionA);
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, "ADMIN-INTERNAL-MEMO", "신고된 컬렉션에서 제거했습니다.");

        var notice = Assert.Single(await ActionNoticesAsync(author, ModerationActionType.ContentRemovedFromCollection));
        Assert.Equal(link, notice.ContentId);
        Assert.Equal("신고된 링크 제목", notice.ContentTitle);
        Assert.Equal("https://img.example.test/a.jpg", notice.ContentImageUrl);
        Assert.Equal(collectionName, notice.CollectionName);
        Assert.Equal("신고된 컬렉션에서 제거했습니다.", notice.Guidance);
        var row = await NewContext().Notifications.SingleAsync(entry => entry.UserId == author && entry.SubjectId == notice.Id);
        Assert.Equal(NotificationType.AdminWarning, row.Type);
        Assert.Contains(row.Id, (await new PushDispatchStore(NewContext()).ListPendingAsync(1000, DateTimeOffset.UtcNow.AddMinutes(1))).Select(entry => entry.Id));

        // Not the reporter, not the Collection's owner, not the operator.
        foreach (var other in new[] { reporter, owner, admin })
        {
            Assert.Empty(await ActionNoticesAsync(other));
            Assert.False(await NewContext().Notifications.AnyAsync(entry => entry.UserId == other && entry.Type == NotificationType.AdminWarning));
        }

        // The recipient's view carries neither the reporter nor the operator's memo.
        var read = (await Notices().GetAsync(author, notice.Id))!;
        Assert.DoesNotContain(ReporterNote, read.Guidance + read.Reason + read.ContentTitle + read.CollectionName);
        Assert.DoesNotContain("ADMIN-INTERNAL-MEMO", read.Guidance + read.Reason + read.ContentTitle + read.CollectionName);
        Assert.DoesNotContain(reporter.ToString(), System.Text.Json.JsonSerializer.Serialize(read));
    }

    [Fact]
    public async Task TheNoticeOfARemovedLink_IsInTheRecipientsNotificationList_AndReadsFromItsSnapshot_OnlyForThem()
    {
        var (author, _) = await NewUserAsync();
        var (owner, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var (stranger, _) = await NewUserAsync();
        var link = await TwoCollectionLinkAsync(author, owner, reporter);
        var (collectionA, _) = _collectionPair;
        var report = await ReportLinkAsync(reporter, link, collectionA);
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null, "안내");

        var notice = Assert.Single(await ActionNoticesAsync(author));
        // The Collection's link is already gone; the list and the reading do not need it.
        Assert.False(await NewContext().CollectionItems.AnyAsync(entry => entry.CollectionId == collectionA && entry.ItemId == link));
        var inbox = Assert.Single(await new NotificationInboxStore(NewContext()).ListAsync(author, null, 20, DateTimeOffset.UtcNow), record => record.SubjectId == notice.Id);
        Assert.Equal(NotificationTargetKinds.ModerationNotice, NotificationInboxPolicy.ResolveTarget(inbox).Kind);
        Assert.Single(await Notices().ListUnacknowledgedAsync(author, 10));
        var read = (await Notices().GetAsync(author, notice.Id))!;
        Assert.Equal("contentRemovedFromCollection", read.ActionType);
        Assert.Equal(notice.ContentTitle, read.ContentTitle);
        Assert.Equal(notice.CollectionName, read.CollectionName);

        // Another account cannot see, open or confirm it - and has no such list entry.
        Assert.Null(await Notices().GetAsync(stranger, notice.Id));
        Assert.False(await Notices().AcknowledgeAsync(stranger, notice.Id, DateTimeOffset.UtcNow));
        Assert.Empty(await Notices().ListUnacknowledgedAsync(stranger, 10));
        Assert.DoesNotContain(await new NotificationInboxStore(NewContext()).ListAsync(stranger, null, 20, DateTimeOffset.UtcNow), record => record.SubjectId == notice.Id);
    }

    [Fact]
    public async Task RemovingAReportedLinkTwice_OrAfterItIsAlreadyGone_ChangesNothingAndNoticesNobodyAgain_AndARestoreFailsSafelyWhenItCannotApply()
    {
        var (author, _) = await NewUserAsync();
        var (owner, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var link = await TwoCollectionLinkAsync(author, owner, reporter);
        var (collectionA, collectionB) = _collectionPair;
        var report = await ReportLinkAsync(reporter, link, collectionA);

        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null, "안내");
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null, "안내");
        Assert.Single(await ActionNoticesAsync(author));
        Assert.Equal(1, await NewContext().Notifications.CountAsync(entry => entry.UserId == author && entry.Type == NotificationType.AdminWarning));
        Assert.True(await NewContext().CollectionItems.AnyAsync(entry => entry.CollectionId == collectionB && entry.ItemId == link));

        // Someone else already took the link out of the Collection (the owner): the action finds nothing to remove and tells nobody.
        var secondLink = await NewLinkAsync(author, collectionA);
        var secondReport = await ReportLinkAsync(reporter, secondLink, collectionA);
        await new CollectionStore(NewContext()).RemoveAsync(owner, collectionA, secondLink);
        await Admin().DeleteTargetAsync(admin, isOwner: true, secondReport, confirm: true, null, "안내");
        Assert.Single(await ActionNoticesAsync(author));

        // Restore puts the one link back; a second restore, or one whose Collection is gone, is refused and changes nothing.
        await Admin().RestoreTargetAsync(admin, isOwner: true, report, null, "복구");
        Assert.True(await NewContext().CollectionItems.AnyAsync(entry => entry.CollectionId == collectionA && entry.ItemId == link));
        var again = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().RestoreTargetAsync(admin, isOwner: true, report, null));
        Assert.Equal(AdminReportConflictException.TargetNotDeleted, again.Code);
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null, "다시");
        await using (var db = NewContext())
        {
            var collection = await db.Collections.SingleAsync(entry => entry.Id == collectionA);
            collection.SoftDelete(DateTimeOffset.UtcNow);
            await db.SaveChangesAsync();
        }

        var cannot = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().RestoreTargetAsync(admin, isOwner: true, report, null));
        Assert.Equal(AdminReportConflictException.TargetNotDeleted, cannot.Code);
        Assert.False(await NewContext().CollectionItems.AnyAsync(entry => entry.CollectionId == collectionA && entry.ItemId == link));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
    }

    [Fact]
    public async Task ARemovedLink_NoticesItsAdderEvenWhenThatPersonIsAlsoAnOperator()
    {
        // An operator who also uses Juple as a person is still the owner of their own saved links: the removal is noticed to them like to anybody.
        var (author, _) = await NewUserAsync();
        var (owner, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var link = await TwoCollectionLinkAsync(author, owner, reporter);
        var (collectionA, _) = _collectionPair;
        _db.AdminUsers.Add(new AdminUser(author, AdminRole.Admin, null, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        try
        {
            var report = await ReportLinkAsync(reporter, link, collectionA);
            await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null, "안내");
            Assert.Single(await ActionNoticesAsync(author, ModerationActionType.ContentRemovedFromCollection));
            Assert.Equal(1, await NewContext().Notifications.CountAsync(entry => entry.UserId == author && entry.Type == NotificationType.AdminWarning));
        }
        finally
        {
            await NewContext().AdminUsers.Where(entry => entry.UserId == author).ExecuteDeleteAsync();
        }
    }

    /// <summary>The same services the Mobile app's 삭제 이력 (GET /api/v1/items/trash) and Home / archive (GET /api/v1/items/history) endpoints call.</summary>
    private sealed class NoImages : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.FromResult<Uri?>(null);
    }

    private async Task<string> ItemRowAsync(long itemId)
    {
        var row = await NewContext().Items.AsNoTracking().Where(item => item.Id == itemId)
            .Select(item => new { item.Id, item.UserId, item.DeletedAtUtc, item.Title, item.Url }).SingleAsync();
        return $"ItemId={row.Id} UserId={row.UserId} DeletedAtUtc={(row.DeletedAtUtc is null ? "null" : "SET")} Url={row.Url}";
    }

    private async Task<(int A, int B, bool InTrash, bool InSavedList, int TrashCount)> ObserveAsync(long author, long link, long collectionA, long collectionB)
    {
        var trash = await new GetItemTrashService(new ItemStore(NewContext()), new NoImages()).GetAsync(author);
        var saved = await new GetItemHistoryService(new ItemStore(NewContext()), new NoImages()).GetAsync(author, null, 100);
        var db = NewContext();
        return (
            await db.CollectionItems.CountAsync(entry => entry.CollectionId == collectionA && entry.ItemId == link),
            await db.CollectionItems.CountAsync(entry => entry.CollectionId == collectionB && entry.ItemId == link),
            trash.Any(entry => entry.Id == link),
            saved.Items.Any(entry => entry.Id == link),
            trash.Count);
    }

    [Fact]
    public async Task RemovingAReportedLink_NeverTouchesTheSavedLink_ItStaysInSavedAndHome_AndNeverAppearsInTheTrashEndpoint()
    {
        var (author, _) = await NewUserAsync();
        var (owner, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var link = await TwoCollectionLinkAsync(author, owner, reporter);
        var (collectionA, collectionB) = _collectionPair;
        var report = await ReportLinkAsync(reporter, link, collectionA);

        var rowBefore = await ItemRowAsync(link);
        var before = await ObserveAsync(author, link, collectionA, collectionB);
        _output.WriteLine("BEFORE  " + rowBefore);
        _output.WriteLine($"BEFORE  collectionA={before.A} collectionB={before.B} savedList={before.InSavedList} trash={before.TrashCount} inTrash={before.InTrash}");
        Assert.Equal((1, 1, false, true, 0), before);

        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, "internal", "신고된 컬렉션에서 제거했습니다.");

        var rowAfter = await ItemRowAsync(link);
        var after = await ObserveAsync(author, link, collectionA, collectionB);
        _output.WriteLine("AFTER   " + rowAfter);
        _output.WriteLine($"AFTER   collectionA={after.A} collectionB={after.B} savedList={after.InSavedList} trash={after.TrashCount} inTrash={after.InTrash}");

        // The Item row is byte-for-byte what it was: no deleted flag, no deleted time, nothing else changed.
        Assert.Equal(rowBefore, rowAfter);
        Assert.Contains("DeletedAtUtc=null", rowAfter);
        // The trash endpoint stays empty, the saved list / Home still has it, and only the reported Collection lost it.
        Assert.Equal((0, 1, false, true, 0), after);

        // The Collection read service (what both Collection screens call): X no longer lists it, Y still does.
        Assert.DoesNotContain(link, (await new CollectionStore(NewContext()).GetItemsAsync(owner, collectionA, null, 50)).Page.Items.Select(entry => entry.ItemId));
        Assert.Contains(link, (await new CollectionStore(NewContext()).GetItemsAsync(author, collectionB, null, 50)).Page.Items.Select(entry => entry.ItemId));
        Assert.Equal(1, await NewContext().AdminAuditLogs.CountAsync(log => log.Action == AdminAuditActions.ContentDeleted && log.TargetId == report.ToString()));

        // The person was told - the notice and its Inbox row exist.
        var notice = Assert.Single(await ActionNoticesAsync(author, ModerationActionType.ContentRemovedFromCollection));
        Assert.Single(await NewContext().Notifications.Where(entry => entry.UserId == author && entry.SubjectId == notice.Id).ToListAsync());

        // Putting it back, and removing it again, never routes it through the trash either.
        await Admin().RestoreTargetAsync(admin, isOwner: true, report, null, "다시 추가했습니다.");
        Assert.Equal((1, 1, false, true, 0), await ObserveAsync(author, link, collectionA, collectionB));
        Assert.Contains(link, (await new CollectionStore(NewContext()).GetItemsAsync(owner, collectionA, null, 50)).Page.Items.Select(entry => entry.ItemId));
        Assert.Equal(1, await NewContext().AdminAuditLogs.CountAsync(log => log.Action == AdminAuditActions.ContentRestored && log.TargetId == report.ToString()));
        Assert.Single(await ActionNoticesAsync(author, ModerationActionType.ContentRestored));
        // A second restore never creates a duplicate link.
        await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().RestoreTargetAsync(admin, isOwner: true, report, null));
        Assert.Equal(1, await NewContext().CollectionItems.CountAsync(entry => entry.CollectionId == collectionA && entry.ItemId == link));
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null);
        Assert.Equal((0, 1, false, true, 0), await ObserveAsync(author, link, collectionA, collectionB));
        Assert.Contains("DeletedAtUtc=null", await ItemRowAsync(link));

        // Control: the person's own delete DOES put it into the trash endpoint - so this test would have caught a moderation move into the trash.
        await new ItemStore(NewContext()).DeleteAsync(author, link, DateTimeOffset.UtcNow);
        var control = await ObserveAsync(author, link, collectionA, collectionB);
        Assert.True(control.InTrash);
        Assert.False(control.InSavedList);
    }

    [Fact]
    public async Task ALinkReportWithoutItsCollection_IsNeverGuessedAt_NothingIsRemovedAndNobodyIsNoticed()
    {
        var (author, _) = await NewUserAsync();
        var (owner, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var link = await TwoCollectionLinkAsync(author, owner, reporter);
        var (collectionA, collectionB) = _collectionPair;
        var report = await ReportLinkAsync(reporter, link, collectionA);
        await NewContext().ContentReports.Where(entry => entry.Id == report).ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.CollectionId, (long?)null));

        var detail = await Admin().GetAsync(report);
        Assert.False(detail.CanDeleteTarget);
        var removal = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null));
        Assert.Equal(AdminReportConflictException.CollectionUnknown, removal.Code);
        var restore = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().RestoreTargetAsync(admin, isOwner: true, report, null));
        Assert.Equal(AdminReportConflictException.CollectionUnknown, restore.Code);

        Assert.Equal(1, await NewContext().CollectionItems.CountAsync(entry => entry.CollectionId == collectionA && entry.ItemId == link));
        Assert.Equal(1, await NewContext().CollectionItems.CountAsync(entry => entry.CollectionId == collectionB && entry.ItemId == link));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
        Assert.Empty(await ActionNoticesAsync(author));
    }

    [Fact]
    public async Task ANotice_KeepsThePictureTitleAndCollection_AfterTheLinkIsGone_ForTheRecipientOnly_WithoutTheReporter()
    {
        var (author, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(author, reporter);
        var link = await NewLinkAsync(author, collection);
        await using (var db = NewContext())
        {
            var item = await db.Items.SingleAsync(candidate => candidate.Id == link);
            item.UpdateDetails("신고된 링크 제목", null);
            item.SetPreviewImageUrl("https://img.example.test/a.jpg");
            await db.SaveChangesAsync();
        }

        var collectionName = await NewContext().Collections.Where(candidate => candidate.Id == collection).Select(candidate => candidate.Name).SingleAsync();
        var report = await ReportLinkAsync(reporter, link, collection);

        await Admin().WarnAsync(admin, report, "확인된 내용", "주의해 주세요.");
        var warningId = await NewContext().ModerationNotices.Where(notice => notice.RecipientUserId == author && notice.Kind == ModerationNoticeKind.Warning).Select(notice => notice.Id).SingleAsync();
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null, "삭제했습니다.");
        var actionId = Assert.Single(await ActionNoticesAsync(author)).Id;

        // Even when the content is gone for good: the notice never reads it.
        await NewContext().CollectionItems.Where(entry => entry.ItemId == link).ExecuteDeleteAsync();
        await NewContext().Items.Where(item => item.Id == link).ExecuteDeleteAsync();
        await NewContext().Collections.Where(candidate => candidate.Id == collection).ExecuteUpdateAsync(setters => setters.SetProperty(candidate => candidate.Name, "바뀐 이름"));

        foreach (var id in new[] { warningId, actionId })
        {
            var read = (await Notices().GetAsync(author, id))!;
            Assert.Equal("신고된 링크 제목", read.ContentTitle);
            Assert.Equal("https://img.example.test/a.jpg", read.ContentImageUrl);
            Assert.Equal(collectionName, read.CollectionName);
            Assert.Equal("Item", read.ContentType);
            Assert.Equal("Harassment", read.ReasonCode);
            Assert.DoesNotContain(ReporterNote, read.Reason + read.Guidance + read.ContentTitle);
            Assert.Null(await Notices().GetAsync(reporter, id));
            Assert.True(await Notices().AcknowledgeAsync(author, id, DateTimeOffset.UtcNow));
            Assert.Equal("신고된 링크 제목", (await Notices().GetAsync(author, id))!.ContentTitle);
        }

        // The reporter's generic result says nothing about the content.
        await Admin().ChangeStatusAsync(admin, report, nameof(ReportStatus.Actioned), null);
        var result = await NewContext().ModerationNotices.SingleAsync(notice => notice.RecipientUserId == reporter && notice.Kind == ModerationNoticeKind.ReportResult);
        Assert.Null(result.ContentTitle);
        Assert.Null(result.ContentImageUrl);
        Assert.Null(result.CollectionName);
    }

    [Fact]
    public async Task AccountRestrictionAndWarning_AreNoticed_EachOnce_AndAFailedActionLeavesNoNotice()
    {
        var (author, _) = await NewUserAsync();
        var (reporter, reporterCode) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(author, reporter);
        var link = await NewLinkAsync(author, collection);
        var report = await ReportLinkAsync(reporter, link, collection);

        await Admin().SetAccountRestrictionAsync(admin, isOwner: true, report, restricted: true, confirm: true, null, "이용을 제한했어요.");
        await Admin().SetAccountRestrictionAsync(admin, isOwner: true, report, restricted: true, confirm: true, null);
        Assert.Single(await ActionNoticesAsync(author, ModerationActionType.AccountRestricted));
        await Admin().SetAccountRestrictionAsync(admin, isOwner: true, report, restricted: false, confirm: false, null);
        Assert.Single(await ActionNoticesAsync(author, ModerationActionType.AccountRestrictionLifted));

        await Admin().WarnAsync(admin, report, "reviewed", "be kind");
        await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().WarnAsync(admin, report, "again", null));
        Assert.Equal(1, await NewContext().ModerationNotices.CountAsync(notice => notice.RecipientUserId == author && notice.Kind == ModerationNoticeKind.Warning));

        // A refused action (a person's account is not deletable) changes nothing and notices nobody.
        await new ReportService(new SafetyStore(NewContext()), TimeProvider.System)
            .CreateAsync(author, new CreateReportCommand("User", reporterCode, null, "Spam", null));
        var personReport = await NewContext().ContentReports.Where(entry => entry.ReporterUserId == author && entry.TargetType == ReportTargetType.User).Select(entry => entry.Id).FirstAsync();
        var noticesBefore = await NewContext().ModerationNotices.CountAsync(notice => notice.RecipientUserId == reporter);
        await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().DeleteTargetAsync(admin, isOwner: true, personReport, confirm: true, null));
        Assert.Equal(noticesBefore, await NewContext().ModerationNotices.CountAsync(notice => notice.RecipientUserId == reporter));
        Assert.True(await NewContext().Users.AnyAsync(user => user.Id == reporter));

        // A message the person will read is bounded.
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null, new string('x', ModerationNotice.GuidanceMaxLength + 1)));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
    }

    [Fact]
    public async Task TwoOperatorsDeletingAtTheSameMoment_NoticeTheAuthorExactlyOnce()
    {
        var (author, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(author, reporter);
        var link = await NewLinkAsync(author, collection);
        var report = await ReportLinkAsync(reporter, link, collection);

        var attempts = await Task.WhenAll(Enumerable.Range(0, 3).Select(async _ =>
        {
            try
            {
                await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null);
                return (Exception?)null;
            }
            catch (AdminReportConflictException exception)
            {
                return exception;
            }
        }));

        // Whoever lost the race is told it was already applied (or simply finds it done); the person is noticed once, the Collection's link is removed once.
        Assert.All(attempts.Where(attempt => attempt is not null), attempt => Assert.Equal(AdminReportConflictException.ActionAlreadyApplied, ((AdminReportConflictException)attempt!).Code));
        Assert.Single(await ActionNoticesAsync(author, ModerationActionType.ContentRemovedFromCollection));
        Assert.Equal(1, await NewContext().Notifications.CountAsync(entry => entry.UserId == author && entry.Type == NotificationType.AdminWarning));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
        Assert.False(await NewContext().CollectionItems.AnyAsync(entry => entry.CollectionId == collection && entry.ItemId == link));
    }

    [Fact]
    public async Task OnlyReportedLinksAndPeopleAreAccepted_ButOldCollectionReportsStayReadableAndActionable()
    {
        var (owner, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, reporter);
        var reports = new ReportService(new SafetyStore(NewContext()), TimeProvider.System);

        await Assert.ThrowsAsync<ReportTypeNotAcceptedException>(() => reports.CreateAsync(reporter, new CreateReportCommand("Collection", collection.ToString(), null, "Spam", null)));

        // A report made before the rule (seeded as it was stored) is untouched: listed and readable by an operator who is no member.
        _db.ContentReports.Add(new ContentReport(reporter, ReportTargetType.Collection, collection, owner, collection, ReportReason.Spam, ReporterNote, DateTimeOffset.UtcNow, "Old name"));
        await _db.SaveChangesAsync();
        var old = await NewContext().ContentReports.Where(report => report.ReporterUserId == reporter && report.TargetType == ReportTargetType.Collection).Select(report => report.Id).FirstAsync();
        Assert.Contains((await Admin().ListAsync("Open", null, 100)).Items, entry => entry.ReportId == old);
        var detail = await Admin().GetAsync(old);
        Assert.Equal("Old name", detail.SnapshotTitle);
        Assert.NotNull(detail.CollectionName);
        Assert.False(detail.CanRestrict);
    }

    [Fact]
    public async Task TheNoticeKeepsWhichLinkInWhichCollection_ReadsTheSameAfterTheLinkIsGone_AndOldNoticesAreRestoredOnlyFromWhatWasStored()
    {
        var (author, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(author, reporter);
        var link = await NewLinkAsync(author, collection);
        await _db.Items.Where(item => item.Id == link).ExecuteUpdateAsync(setters => setters
            .SetProperty(item => item.Title, "내가 올린 링크 제목")
            .SetProperty(item => item.PreviewImageUrl, "https://img.example.test/preview.jpg"));
        var collectionName = await _db.Collections.Where(entry => entry.Id == collection).Select(entry => entry.Name).FirstAsync();
        var report = await ReportLinkAsync(reporter, link, collection);

        await Admin().WarnAsync(admin, report, "reviewed", "be kind");
        await Admin().DeleteTargetAsync(admin, isOwner: true, report, confirm: true, null, "삭제했어요");

        var warning = await NewContext().ModerationNotices.SingleAsync(notice => notice.RecipientUserId == author && notice.Kind == ModerationNoticeKind.Warning);
        var deleted = Assert.Single(await ActionNoticesAsync(author, ModerationActionType.ContentRemovedFromCollection));
        foreach (var notice in new[] { warning, deleted })
        {
            Assert.Equal("내가 올린 링크 제목", notice.ContentTitle);
            Assert.Equal(collectionName, notice.CollectionName);
            Assert.Equal("https://img.example.test/preview.jpg", notice.ContentImageUrl);
            Assert.Equal(link, notice.ContentId);
        }

        // The link is deleted for good and the Collection renamed: the notice reads exactly as it was made - from itself, never from the link.
        await _db.CollectionItems.Where(membership => membership.ItemId == link).ExecuteDeleteAsync();
        await _db.Items.Where(item => item.Id == link).ExecuteDeleteAsync();
        await _db.Collections.Where(entry => entry.Id == collection).ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Name, "다른 이름"));
        foreach (var id in new[] { warning.Id, deleted.Id })
        {
            var read = (await Notices().GetAsync(author, id))!;
            Assert.Equal("내가 올린 링크 제목", read.ContentTitle);
            Assert.Equal(collectionName, read.CollectionName);
            Assert.Equal("https://img.example.test/preview.jpg", read.ContentImageUrl);
            Assert.DoesNotContain(ReporterNote, string.Concat(read.ContentTitle, read.CollectionName, read.Reason, read.Guidance));
            Assert.Null(await Notices().GetAsync(reporter, id));
            Assert.Null(await Notices().GetAsync(admin, id));
        }

        // The pop-up list carries the same snapshot.
        Assert.All(await Notices().ListUnacknowledgedAsync(author, 10), notice => Assert.Equal("내가 올린 링크 제목", notice.ContentTitle));

        // What the reporter is told names nothing of the other person's content.
        await Admin().ChangeStatusAsync(admin, report, "Actioned", null);
        var result = await NewContext().ModerationNotices.SingleAsync(notice => notice.RecipientUserId == reporter);
        Assert.Null(result.ContentTitle);
        Assert.Null(result.CollectionName);
        Assert.Null(result.ContentImageUrl);
        Assert.Null(result.ContentId);
    }
}
