using System.Data.Common;
using Juple.Application.Admin;
using Juple.Application.Support;
using Juple.Domain.Admin;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Support;
using Juple.Domain.Users;
using Juple.Infrastructure.Admin;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Support;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Juple.IntegrationTests.Admin;

/// <summary>
/// The Admin API's data side against the real SQL Server schema: dashboard aggregates, the user directory, operating the EXISTING
/// support inquiries (the person sees the same row), the audit record written in the same transaction, and the grant lookup.
/// </summary>
public sealed class AdminIntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private readonly List<long> _userIds = [];
    private readonly List<long> _inquiryIds = [];

    public Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run the admin integration tests against a local SQL Server.");
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await using var db = NewContext();
        foreach (var id in _inquiryIds)
        {
            var targetId = id.ToString(System.Globalization.CultureInfo.InvariantCulture);
            await db.AdminAuditLogs.Where(log => log.TargetType == AdminAuditTargets.SupportInquiry && log.TargetId == targetId).ExecuteDeleteAsync();
        }

        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(db).DeleteAllDataAsync(userId, $"test/admin/{userId}/", DateTimeOffset.UtcNow);
        }

        await db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/admin/%'");
    }

    private JupleDbContext NewContext(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).AddInterceptors(interceptors).Options);

    private AdminService NewAdminService(JupleDbContext? db = null)
    {
        db ??= NewContext();
        return new AdminService(new AdminDashboardStore(db), new AdminUserDirectoryStore(db), new AdminSupportInquiryStore(db), TimeProvider.System);
    }

    private async Task<User> NewUserAsync(DateTimeOffset? createdAtUtc = null)
    {
        await using var db = NewContext();
        var at = createdAtUtc ?? DateTimeOffset.UtcNow;
        var user = new User("ko-KR", "Asia/Seoul", null, at, at);
        db.Users.Add(user);
        await db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user;
    }

    private async Task<long> NewInquiryAsync(long userId, string content = "The app crashes when I save a link")
    {
        var created = await new SupportInquiryService(new SupportInquiryStore(NewContext()), TimeProvider.System).CreateAsync(
            userId,
            new CreateSupportInquiryCommand(Guid.NewGuid(), "Bug", content, new SupportInquiryDiagnosticsInput("1.0", "31", "android", "16", "SM-S936N", "ko-KR")));
        _inquiryIds.Add(created.Inquiry.InquiryId);
        return created.Inquiry.InquiryId;
    }

    private static SupportInquiryService UserFacing() =>
        new(new SupportInquiryStore(new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>()
            .UseSqlServer(Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")!).Options)), TimeProvider.System);

    // ---------- dashboard ----------

    [Fact]
    public async Task Dashboard_CountsWithSqlAggregates_UsingTheDocumentedDefinitions()
    {
        var todayStart = DateTimeOffset.UtcNow.AddHours(-1);
        var before = await NewAdminService().GetDashboardSummaryAsync(todayStart);

        var person = await NewUserAsync();
        await using (var db = NewContext())
        {
            var kept = new Item(person.Id, "https://example.com/admin-test/kept", DateTimeOffset.UtcNow);
            var trashed = new Item(person.Id, "https://example.com/admin-test/trashed", DateTimeOffset.UtcNow);
            trashed.SoftDelete(DateTimeOffset.UtcNow);
            var shared = new Collection(person.Id, "Shared", "shared", CollectionIcon.Folder, DateTimeOffset.UtcNow);
            var plain = new Collection(person.Id, "Plain", "plain", CollectionIcon.Folder, DateTimeOffset.UtcNow);
            db.AddRange(kept, trashed, shared, plain);
            await db.SaveChangesAsync();
            db.CollectionShares.Add(new CollectionShare(shared.Id, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        await NewInquiryAsync(person.Id);
        var answered = await NewInquiryAsync(person.Id);
        await NewAdminService().AnswerInquiryAsync(person.Id, answered, "Done");

        var after = await NewAdminService().GetDashboardSummaryAsync(todayStart);

        Assert.Equal(1, after.TotalUsers - before.TotalUsers);
        Assert.Equal(1, after.NewUsersToday - before.NewUsersToday);
        Assert.Equal(1, after.NewUsersLast7Days - before.NewUsersLast7Days);
        Assert.Equal(1, after.TotalLinks - before.TotalLinks); // the trashed one is not a saved link any more
        Assert.Equal(2, after.LinksSavedToday - before.LinksSavedToday); // ...but it was saved today
        Assert.Equal(2, after.TotalCollections - before.TotalCollections);
        Assert.Equal(1, after.SharedCollections - before.SharedCollections);
        Assert.Equal(1, after.OpenInquiries - before.OpenInquiries); // the answered one is not open
    }

    [Fact]
    public async Task Dashboard_TodayFollowsTheGivenStart_AndTheWeekIsSevenDays()
    {
        var todayStart = DateTimeOffset.UtcNow.AddHours(-1);
        var before = await NewAdminService().GetDashboardSummaryAsync(todayStart);

        await NewUserAsync(todayStart.AddDays(-3)); // this week, not today
        await NewUserAsync(todayStart.AddDays(-9)); // older than the 7-day window

        var after = await NewAdminService().GetDashboardSummaryAsync(todayStart);
        Assert.Equal(2, after.TotalUsers - before.TotalUsers);
        Assert.Equal(0, after.NewUsersToday - before.NewUsersToday);
        Assert.Equal(1, after.NewUsersLast7Days - before.NewUsersLast7Days);
    }

    // ---------- users ----------

    [Fact]
    public async Task Users_ListIdentifiersAndCounts_AndFindsAnExactJupleId()
    {
        var person = await NewUserAsync();
        await using (var db = NewContext())
        {
            var trashed = new Item(person.Id, "https://example.com/admin-test/u2", DateTimeOffset.UtcNow);
            trashed.SoftDelete(DateTimeOffset.UtcNow);
            db.AddRange(
                new Item(person.Id, "https://example.com/admin-test/u1", DateTimeOffset.UtcNow),
                trashed,
                new Collection(person.Id, "C", "c", CollectionIcon.Folder, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
        }

        var page = await NewAdminService().ListUsersAsync("@" + person.PublicCode[..4] + "-" + person.PublicCode[4..], null, null);

        var row = Assert.Single(page.Items);
        Assert.Equal((person.Id, person.PublicCode, "ko-KR", false, 1, 1), (row.UserId, row.JupleId, row.PreferredLocale, row.TermsAccepted, row.LinkCount, row.CollectionCount));

        // Pagination must use this test's own rows, including on a freshly created test database.
        var second = await NewUserAsync();
        var newest = await NewAdminService().ListUsersAsync(null, null, 1);
        Assert.Equal(second.Id, Assert.Single(newest.Items).UserId);
        Assert.NotNull(newest.NextCursor);
        var next = await NewAdminService().ListUsersAsync(null, newest.NextCursor, 1);
        Assert.Equal(person.Id, Assert.Single(next.Items).UserId);
    }

    // ---------- inquiries ----------

    [Fact]
    public async Task Inquiries_AreTheExistingRows_WithTheirDiagnosticsAndThePerson()
    {
        var person = await NewUserAsync();
        var inquiryId = await NewInquiryAsync(person.Id);

        var list = await NewAdminService().ListInquiriesAsync("Pending", null, 100);
        var item = Assert.Single(list.Items, entry => entry.InquiryId == inquiryId);
        Assert.Equal(("Pending", "Bug", person.PublicCode), (item.Status, item.Type, item.User!.JupleId));
        Assert.Equal("The app crashes when I save a link", item.ContentPreview);

        var detail = await NewAdminService().GetInquiryAsync(inquiryId);
        Assert.Equal(new AdminInquiryDiagnostics("1.0", "31", "android", "16", "SM-S936N", "ko-KR"), detail.Diagnostics);
        Assert.Equal(person.Id, detail.User!.UserId);
        Assert.Empty(detail.History);
    }

    [Fact]
    public async Task AStatusChange_IsAudited_AndThePersonSeesIt()
    {
        var admin = await NewUserAsync();
        var person = await NewUserAsync();
        var inquiryId = await NewInquiryAsync(person.Id);
        var startedAt = DateTimeOffset.UtcNow.AddSeconds(-1);

        var detail = await NewAdminService().ChangeInquiryStatusAsync(admin.Id, inquiryId, "InProgress");

        Assert.Equal("InProgress", detail.Status);
        Assert.NotNull(detail.UpdatedAtUtc);
        var audit = Assert.Single(detail.History);
        Assert.Equal((admin.Id, admin.PublicCode, AdminAuditActions.SupportInquiryStatusChanged, "Pending->InProgress"), (audit.AdminUserId, audit.AdminJupleId, audit.Action, audit.Detail));
        Assert.True(audit.CreatedAtUtc >= startedAt);

        var seenByThePerson = await UserFacing().GetAsync(person.Id, inquiryId);
        Assert.Equal("InProgress", seenByThePerson.Status);

        // The same status again changes nothing and writes no second record.
        var again = await NewAdminService().ChangeInquiryStatusAsync(admin.Id, inquiryId, "InProgress");
        Assert.Single(again.History);
    }

    [Fact]
    public async Task AnAnswer_IsTheSameRowThePersonReads_AndTheAuditNeverHoldsItsText()
    {
        var admin = await NewUserAsync();
        var person = await NewUserAsync();
        var inquiryId = await NewInquiryAsync(person.Id);

        var detail = await NewAdminService().AnswerInquiryAsync(admin.Id, inquiryId, "  We fixed this in build 31.  ");

        Assert.Equal(("Answered", "We fixed this in build 31."), (detail.Status, detail.Answer));
        var audit = Assert.Single(detail.History);
        Assert.Equal(AdminAuditActions.SupportInquiryAnswered, audit.Action);
        Assert.DoesNotContain("fixed", audit.Detail!, StringComparison.OrdinalIgnoreCase);

        var seenByThePerson = await UserFacing().GetAsync(person.Id, inquiryId);
        Assert.Equal(("Answered", "We fixed this in build 31."), (seenByThePerson.Status, seenByThePerson.Answer));
        Assert.NotNull(seenByThePerson.AnsweredAtUtc);
        var personsList = await UserFacing().ListAsync(person.Id, null, null);
        Assert.Equal("Answered", Assert.Single(personsList.Items, entry => entry.InquiryId == inquiryId).Status);

        // An answered inquiry cannot be moved back (the answer stays), and nothing is audited for the refusal.
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => NewAdminService().ChangeInquiryStatusAsync(admin.Id, inquiryId, "Pending"));
        Assert.Single((await NewAdminService().GetInquiryAsync(inquiryId)).History);
    }

    [Fact]
    public async Task WhenTheAuditInsertFails_TheInquiryChangeIsRolledBackToo()
    {
        var admin = await NewUserAsync();
        var person = await NewUserAsync();
        var inquiryId = await NewInquiryAsync(person.Id);

        await using (var failing = NewContext(new FailAuditInsert()))
        {
            await Assert.ThrowsAnyAsync<Exception>(() => NewAdminService(failing).AnswerInquiryAsync(admin.Id, inquiryId, "Never stored"));
        }

        await using var db = NewContext();
        var row = await db.SupportInquiries.AsNoTracking().SingleAsync(inquiry => inquiry.Id == inquiryId);
        Assert.Equal((SupportInquiryStatus.Pending, (string?)null, (DateTimeOffset?)null), (row.Status, row.Answer, row.UpdatedAtUtc));
        var targetId = inquiryId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        Assert.False(await db.AdminAuditLogs.AnyAsync(log => log.TargetId == targetId && log.TargetType == AdminAuditTargets.SupportInquiry));
    }

    [Fact]
    public async Task AMissingInquiry_IsNotFound_ForEveryOperation()
    {
        await Assert.ThrowsAsync<AdminInquiryNotFoundException>(() => NewAdminService().GetInquiryAsync(long.MaxValue));
        await Assert.ThrowsAsync<AdminInquiryNotFoundException>(() => NewAdminService().ChangeInquiryStatusAsync(1, long.MaxValue, "InProgress"));
        await Assert.ThrowsAsync<AdminInquiryNotFoundException>(() => NewAdminService().AnswerInquiryAsync(1, long.MaxValue, "x"));
    }

    // ---------- grants ----------

    [Fact]
    public async Task OnlyAnActiveGrantAuthorizes_AndAGrantEndsWithTheAccount()
    {
        var active = await NewUserAsync();
        var inactive = await NewUserAsync();
        var none = await NewUserAsync();
        await using (var db = NewContext())
        {
            db.AdminUsers.Add(new AdminUser(active.Id, AdminRole.Owner, null, DateTimeOffset.UtcNow));
            db.AdminUsers.Add(new AdminUser(inactive.Id, AdminRole.Admin, active.Id, DateTimeOffset.UtcNow));
            await db.SaveChangesAsync();
            await db.Database.ExecuteSqlAsync($"UPDATE admin.AdminUsers SET IsActive = 0 WHERE UserId = {inactive.Id}");
        }

        var store = new AdminAccessStore(NewContext());
        Assert.Equal(new AdminAccess(active.Id, AdminRole.Owner), await store.FindActiveAsync(active.Id));
        Assert.Null(await store.FindActiveAsync(inactive.Id));
        Assert.Null(await store.FindActiveAsync(none.Id));

        await using (var db = NewContext())
        {
            await new AccountDeletionStore(db).DeleteAllDataAsync(active.Id, $"test/admin/{active.Id}/", DateTimeOffset.UtcNow);
            Assert.False(await db.AdminUsers.AnyAsync(admin => admin.UserId == active.Id));
        }

        _userIds.Remove(active.Id);
    }

    /// <summary>Fails the audit INSERT inside the same SaveChanges, after the inquiry UPDATE was already sent.</summary>
    private sealed class FailAuditInsert : DbCommandInterceptor
    {
        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken cancellationToken = default) =>
            command.CommandText.Contains("AdminAuditLogs", StringComparison.Ordinal) && command.CommandText.Contains("INSERT", StringComparison.Ordinal)
                ? throw new InvalidOperationException("simulated audit failure")
                : base.ReaderExecutingAsync(command, eventData, result, cancellationToken);

        public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default) =>
            command.CommandText.Contains("AdminAuditLogs", StringComparison.Ordinal) && command.CommandText.Contains("INSERT", StringComparison.Ordinal)
                ? throw new InvalidOperationException("simulated audit failure")
                : base.NonQueryExecutingAsync(command, eventData, result, cancellationToken);
    }
}
