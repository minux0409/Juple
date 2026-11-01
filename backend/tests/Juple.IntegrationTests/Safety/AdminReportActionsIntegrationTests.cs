using Juple.Application.Admin;
using Juple.Application.Notifications;
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
/// The operator's actions on a report, against the real schema: the reviewed warning (one per report, DB notice + Inbox row for the push
/// dispatcher, nothing of the report in it), the reporter's generic result, soft deletion with restore, and the read-only account restriction -
/// each with its audit record, the destructive ones Owner-role only.
/// </summary>
public sealed class AdminReportActionsIntegrationTests : IAsyncLifetime
{
    private const string ReporterNote = "REPORTER-PRIVATE-EXPLANATION";

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
        await _db.AdminUsers.Where(admin => _userIds.Contains(admin.UserId)).ExecuteDeleteAsync();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/adminreport/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/adminreport/%'");
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
        var collection = await new CollectionStore(_db).CreateAsync(owner, "AdminReport " + Guid.NewGuid().ToString("N")[..8], Guid.NewGuid().ToString("N"), CollectionIcon.Folder, DateTimeOffset.UtcNow, null);
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

    private ReportService Reports() => new(new SafetyStore(NewContext()), TimeProvider.System);

    private AdminReportService Admin() => new(new AdminReportStore(NewContext()), TimeProvider.System);

    private async Task<long> ReportAsync(long reporter, string type, string targetId, long? collectionId)
    {
        await Reports().CreateAsync(reporter, new CreateReportCommand(type, targetId, collectionId, "Harassment", ReporterNote));
        var targetKey = type == "User" ? await NewContext().Users.Where(user => user.PublicCode == targetId).Select(user => user.Id).FirstAsync() : long.Parse(targetId);
        return await NewContext().ContentReports
            .Where(report => report.ReporterUserId == reporter && report.TargetType == Enum.Parse<ReportTargetType>(type) && report.TargetId == targetKey)
            .Select(report => report.Id).FirstAsync();
    }

    private async Task<long> GrantOperatorAsync(long userId, AdminRole role)
    {
        _db.AdminUsers.Add(new AdminUser(userId, role, null, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        return userId;
    }

    [Fact]
    public async Task Warning_IsReviewedWords_StoredOnce_InTheInbox_AndNeverCarriesTheReport()
    {
        var (owner, _) = await NewUserAsync();
        var (author, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, author, reporter);
        var link = await NewLinkAsync(author, collection);
        var report = await ReportAsync(reporter, "Item", link.ToString(), collection);

        var detail = await Admin().GetAsync(report);
        Assert.True(detail.CanWarn);
        Assert.Null(detail.WarningSentAtUtc);

        var sent = await Admin().WarnAsync(admin, report, "  Repeated insults in a link title.  ", "Please keep titles respectful.");

        Assert.NotNull(sent.WarningSentAtUtc);
        Assert.Equal("InReview", sent.Status);
        var notice = await NewContext().ModerationNotices.SingleAsync(entry => entry.ReportId == report);
        Assert.Equal(author, notice.RecipientUserId);
        Assert.Equal(ModerationNoticeKind.Warning, notice.Kind);
        Assert.Equal("Repeated insults in a link title.", notice.Reason);
        Assert.DoesNotContain(ReporterNote, notice.Reason + notice.Guidance);
        // One Inbox row for the push dispatcher: no actor (the reporter is never named), undispatched until the push is sent.
        var row = await NewContext().Notifications.SingleAsync(entry => entry.UserId == author && entry.Type == NotificationType.AdminWarning);
        Assert.Equal(notice.Id, row.SubjectId);
        Assert.Null(row.ActorUserId);
        Assert.Null(row.DispatchedAtUtc);
        Assert.NotNull(row.DedupKey);
        Assert.Contains(row.Id, (await new PushDispatchStore(NewContext()).ListPendingAsync(1000, DateTimeOffset.UtcNow.AddMinutes(1))).Select(entry => entry.Id));

        // The recipient finds it in the Inbox, pointing at the notice; the push says only that there is a message, in their language.
        var inbox = await new NotificationInboxStore(NewContext()).ListAsync(author, null, 20, DateTimeOffset.UtcNow);
        var inboxRow = Assert.Single(inbox, record => record.Type == NotificationType.AdminWarning);
        var target = NotificationInboxPolicy.ResolveTarget(inboxRow);
        Assert.Equal(NotificationTargetKinds.ModerationNotice, target.Kind);
        Assert.Equal(notice.Id, target.NoticeId);
        var (title, body) = SocialPushText.For(NotificationType.AdminWarning, "ko-KR", string.Empty, string.Empty);
        Assert.Equal("Juple 이용 안내", title);
        Assert.DoesNotContain("insults", body);
        Assert.Equal("adminWarning", SocialNotificationPolicy.WireType(NotificationType.AdminWarning));

        // The dispatcher keeps it relevant (an unknown type would be dropped silently) and builds a visible push that carries only ids.
        var contexts = await new PushDispatchStore(NewContext()).GetContextsAsync([row], DateTimeOffset.UtcNow);
        Assert.True(contexts[row.Id].IsRelevant);
        var payload = DispatchPendingPushNotificationsService.BuildPayload(row, contexts[row.Id], "ko-KR");
        Assert.Equal("Juple 이용 안내", payload.Title);
        Assert.Equal("adminWarning", payload.Type);
        Assert.Equal(notice.Id.ToString(), payload.Data["noticeId"]);
        Assert.DoesNotContain("insults", payload.Body);
        Assert.DoesNotContain(payload.Data.Values, value => value.Contains("insults") || value.Contains("respectful"));

        // Only the recipient can read or confirm it; confirming is stored and repeatable.
        var noticeStore = () => new ModerationNoticeStore(NewContext());
        Assert.Null(await noticeStore().GetAsync(reporter, notice.Id));
        Assert.False(await noticeStore().AcknowledgeAsync(reporter, notice.Id, DateTimeOffset.UtcNow));
        var read = await noticeStore().GetAsync(author, notice.Id);
        Assert.Equal("Please keep titles respectful.", read!.Guidance);
        Assert.Null(read.AcknowledgedAtUtc);
        Assert.True(await noticeStore().AcknowledgeAsync(author, notice.Id, DateTimeOffset.UtcNow));
        Assert.True(await noticeStore().AcknowledgeAsync(author, notice.Id, DateTimeOffset.UtcNow));
        Assert.NotNull((await noticeStore().GetAsync(author, notice.Id))!.AcknowledgedAtUtc);
        Assert.True((await Admin().GetAsync(report)).WarningAcknowledged);

        // A second click, or a second operator, cannot send it twice.
        var conflict = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().WarnAsync(admin, report, "again", null));
        Assert.Equal(AdminReportConflictException.WarningAlreadySent, conflict.Code);
        Assert.Equal(1, await NewContext().ModerationNotices.CountAsync(entry => entry.ReportId == report));
        Assert.Equal(1, await NewContext().Notifications.CountAsync(entry => entry.UserId == author && entry.Type == NotificationType.AdminWarning));
        Assert.Equal(1, await NewContext().AdminAuditLogs.CountAsync(log => log.Action == AdminAuditActions.ReportWarningSent && log.TargetId == report.ToString()));
    }

    [Fact]
    public async Task Warning_NeedsWordsAndAPerson_NeverAnOperator_AndFailsAsOneTransaction()
    {
        var (owner, _) = await NewUserAsync();
        var (operatorUser, operatorCode) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        await GrantOperatorAsync(operatorUser, AdminRole.Admin);
        var collection = await NewCollectionAsync(owner, operatorUser, reporter);
        var report = await ReportAsync(reporter, "User", operatorCode, collection);

        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Admin().WarnAsync(admin, report, "   ", null));
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Admin().WarnAsync(admin, report, new string('x', ModerationNotice.ReasonMaxLength + 1), null));
        // A report about an operator's account cannot be warned: nothing was written.
        var conflict = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().WarnAsync(admin, report, "reviewed", null));
        Assert.Equal(AdminReportConflictException.NoTargetUser, conflict.Code);
        Assert.Equal(0, await NewContext().ModerationNotices.CountAsync(entry => entry.ReportId == report));
        Assert.Equal(0, await NewContext().Notifications.CountAsync(entry => entry.UserId == operatorUser && entry.Type == NotificationType.AdminWarning));
        await Assert.ThrowsAsync<AdminReportNotFoundException>(() => Admin().WarnAsync(admin, long.MaxValue, "reviewed", null));
    }

    [Fact]
    public async Task ReporterHearsOnlyThatItWasReviewed_Once_NeverWhatWasDecided()
    {
        var (owner, _) = await NewUserAsync();
        var (author, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, author, reporter);
        var link = await NewLinkAsync(author, collection);
        var report = await ReportAsync(reporter, "Item", link.ToString(), collection);

        await Admin().ChangeStatusAsync(admin, report, "InReview", null);
        Assert.Equal(0, await NewContext().ModerationNotices.CountAsync(entry => entry.RecipientUserId == reporter));

        await Admin().ChangeStatusAsync(admin, report, "Dismissed", "nothing wrong");
        var notice = await NewContext().ModerationNotices.SingleAsync(entry => entry.RecipientUserId == reporter);
        Assert.Equal(ModerationNoticeKind.ReportResult, notice.Kind);
        Assert.Null(notice.Reason);
        Assert.Null(notice.Guidance);
        Assert.Equal(1, await NewContext().Notifications.CountAsync(entry => entry.UserId == reporter && entry.Type == NotificationType.ReportResultNotice));
        // The reported person is told nothing by a dismissal.
        Assert.Equal(0, await NewContext().Notifications.CountAsync(entry => entry.UserId == author && entry.Type == NotificationType.AdminWarning));

        await Admin().ChangeStatusAsync(admin, report, "Actioned", null);
        Assert.Equal(1, await NewContext().ModerationNotices.CountAsync(entry => entry.RecipientUserId == reporter));
        Assert.Equal("reportResult", (await new ModerationNoticeStore(NewContext()).GetAsync(reporter, notice.Id))!.Kind);
    }

    [Fact]
    public async Task DeletingAReportedLinkOrCollection_NeedsTheOwnerRoleAndConfirmation_IsSoft_AndRestorable()
    {
        var (owner, _) = await NewUserAsync();
        var (author, authorCode) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, author, reporter);
        var link = await NewLinkAsync(author, collection);
        var itemReport = await ReportAsync(reporter, "Item", link.ToString(), collection);
        var collectionReport = await ReportAsync(reporter, "Collection", collection.ToString(), null);
        var personReport = await ReportAsync(reporter, "User", authorCode, null);

        await Assert.ThrowsAsync<AdminReportForbiddenException>(() => Admin().DeleteTargetAsync(admin, isOwner: false, itemReport, confirm: true, null));
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Admin().DeleteTargetAsync(admin, isOwner: true, itemReport, confirm: false, null));
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));

        var deleted = await Admin().DeleteTargetAsync(admin, isOwner: true, itemReport, confirm: true, "removed");
        Assert.True(deleted.TargetDeleted);
        Assert.False(deleted.TargetExists);
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc != null));
        // The row is kept (soft delete): nothing is gone for good, and the report's snapshot stays.
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link));
        Assert.DoesNotContain(link, (await new CollectionStore(NewContext()).GetItemsAsync(owner, collection, null, 50)).Page.Items.Select(entry => entry.ItemId));
        Assert.Equal(1, await NewContext().AdminAuditLogs.CountAsync(log => log.Action == AdminAuditActions.ContentDeleted && log.TargetId == itemReport.ToString()));
        await Admin().DeleteTargetAsync(admin, isOwner: true, itemReport, confirm: true, null); // idempotent

        var restored = await Admin().RestoreTargetAsync(admin, isOwner: true, itemReport, null);
        Assert.False(restored.TargetDeleted);
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
        var nothingToRestore = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().RestoreTargetAsync(admin, isOwner: true, itemReport, null));
        Assert.Equal(AdminReportConflictException.TargetNotDeleted, nothingToRestore.Code);

        var collectionGone = await Admin().DeleteTargetAsync(admin, isOwner: true, collectionReport, confirm: true, null);
        Assert.True(collectionGone.TargetDeleted);
        Assert.True(await NewContext().Collections.AnyAsync(entry => entry.Id == collection && entry.DeletedAtUtc != null));
        await Admin().RestoreTargetAsync(admin, isOwner: true, collectionReport, null);
        Assert.True(await NewContext().Collections.AnyAsync(entry => entry.Id == collection && entry.DeletedAtUtc == null));
        Assert.True(await NewContext().CollectionCollaborators.AnyAsync(member => member.CollectionId == collection && member.UserId == author));

        // A person's account is never deleted by a report.
        var notDeletable = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().DeleteTargetAsync(admin, isOwner: true, personReport, confirm: true, null));
        Assert.Equal(AdminReportConflictException.NotDeletable, notDeletable.Code);
        Assert.False((await Admin().GetAsync(personReport)).CanDeleteTarget);
    }

    [Fact]
    public async Task AccountRestriction_IsOwnerOnly_Confirmed_NeverAnOperator_AndLiftable()
    {
        var (owner, _) = await NewUserAsync();
        var (author, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (operatorUser, operatorCode) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        await GrantOperatorAsync(operatorUser, AdminRole.Admin);
        var collection = await NewCollectionAsync(owner, author, reporter, operatorUser);
        var link = await NewLinkAsync(author, collection);
        var report = await ReportAsync(reporter, "Item", link.ToString(), collection);
        var operatorReport = await ReportAsync(reporter, "User", operatorCode, null);
        var store = new ModerationNoticeStore(NewContext());

        // One report is only a report: nothing restricts the account by itself.
        Assert.False(await store.IsUsageRestrictedAsync(author));
        await Assert.ThrowsAsync<AdminReportForbiddenException>(() => Admin().SetAccountRestrictionAsync(admin, isOwner: false, report, restricted: true, confirm: true, null));
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Admin().SetAccountRestrictionAsync(admin, isOwner: true, report, restricted: true, confirm: false, null));
        Assert.False(await new ModerationNoticeStore(NewContext()).IsUsageRestrictedAsync(author));

        var restricted = await Admin().SetAccountRestrictionAsync(admin, isOwner: true, report, restricted: true, confirm: true, "repeat abuse");
        Assert.True(restricted.TargetAccountRestricted);
        Assert.True(await new ModerationNoticeStore(NewContext()).IsUsageRestrictedAsync(author));
        // Nothing of the person's data is deleted or hidden by it.
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
        Assert.True(await NewContext().CollectionCollaborators.AnyAsync(member => member.CollectionId == collection && member.UserId == author));
        await Admin().SetAccountRestrictionAsync(admin, isOwner: true, report, restricted: true, confirm: true, null); // idempotent
        Assert.Equal(1, await NewContext().AdminAuditLogs.CountAsync(log => log.Action == AdminAuditActions.AccountRestricted && log.TargetId == report.ToString()));

        var operatorRefused = await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().SetAccountRestrictionAsync(admin, isOwner: true, operatorReport, restricted: true, confirm: true, null));
        Assert.Equal(AdminReportConflictException.NotAccountRestrictable, operatorRefused.Code);

        var lifted = await Admin().SetAccountRestrictionAsync(admin, isOwner: true, report, restricted: false, confirm: false, null);
        Assert.False(lifted.TargetAccountRestricted);
        Assert.False(await new ModerationNoticeStore(NewContext()).IsUsageRestrictedAsync(author));
        Assert.Equal(1, await NewContext().AdminAuditLogs.CountAsync(log => log.Action == AdminAuditActions.AccountRestrictionLifted && log.TargetId == report.ToString()));
    }

    [Fact]
    public async Task AccountDeletion_TakesTheOperatorMessagesWithTheAccount()
    {
        var (owner, _) = await NewUserAsync();
        var (author, _) = await NewUserAsync();
        var (reporter, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, author, reporter);
        var link = await NewLinkAsync(author, collection);
        var report = await ReportAsync(reporter, "Item", link.ToString(), collection);
        await Admin().WarnAsync(admin, report, "reviewed", "be kind");

        await new AccountDeletionStore(NewContext()).DeleteAllDataAsync(author, $"test/adminreport/{author}/", DateTimeOffset.UtcNow);
        _userIds.Remove(author);

        Assert.Equal(0, await NewContext().ModerationNotices.CountAsync(entry => entry.RecipientUserId == author));
        Assert.Equal(0, await NewContext().Notifications.CountAsync(entry => entry.UserId == author));
        // The report itself stays as anonymous moderation evidence.
        Assert.True(await NewContext().ContentReports.AnyAsync(entry => entry.Id == report));
    }
}
