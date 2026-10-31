using Juple.Application.Admin;
using Juple.Application.Collections;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Safety;
using Juple.Domain.Collections;
using Juple.Domain.Safety;
using Juple.Domain.Users;
using Juple.Infrastructure.Admin;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Safety;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Safety;

/// <summary>
/// The shared-Collection policy against the real schema: a report is separate from a block, a block hides but never removes, and an operator's
/// share restriction shuts members and the public link out while the Owner keeps everything.
/// </summary>
public sealed class SharedContentModerationIntegrationTests : IAsyncLifetime
{
    private const string Marker = "[moderation-test]";

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
        await _db.ContentReports.Where(report => report.CollectionId != null && _collectionIds.Contains(report.CollectionId.Value)).ExecuteDeleteAsync();
        await _db.AdminAuditLogs.Where(log => _userIds.Contains(log.AdminUserId)).ExecuteDeleteAsync();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/moderation/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/moderation/%'");
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

    private async Task<long> NewCollectionAsync(long owner, params long[] members)
    {
        var collection = await new CollectionStore(_db).CreateAsync(owner, "Moderation " + Guid.NewGuid().ToString("N")[..8], Guid.NewGuid().ToString("N"), CollectionIcon.Folder, DateTimeOffset.UtcNow, null);
        foreach (var member in members)
        {
            _db.CollectionCollaborators.Add(new CollectionCollaborator(collection.Id, member, CollectionCollaboratorRole.Contributor, owner, DateTimeOffset.UtcNow));
        }

        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        _collectionIds.Add(collection.Id);
        return collection.Id;
    }

    private async Task<long> NewItemInAsync(long userId, long collectionId)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, "https://example.test/" + Guid.NewGuid().ToString("N"), null, DateTimeOffset.UtcNow);
        await new CollectionStore(_db).AddAsync(userId, collectionId, saved.Entry.Id, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private async Task<string> MakePublicAsync(long collectionId)
    {
        await _db.CollectionShares.Where(share => share.CollectionId == collectionId).ExecuteUpdateAsync(setters => setters.SetProperty(share => share.IsPublic, true));
        return await _db.CollectionShares.Where(share => share.CollectionId == collectionId).Select(share => share.PublicId).FirstAsync();
    }

    private ReportService Reports() => new(new SafetyStore(NewContext()), TimeProvider.System);

    private AdminReportService Admin() => new(new AdminReportStore(NewContext()), TimeProvider.System);

    private UserBlockService Blocks() => new(new UserDirectoryStore(NewContext()), new SafetyStore(NewContext()), TimeProvider.System);

    private async Task<long> ReportIdAsync(long reporter, ReportTargetType type, long targetId) =>
        await NewContext().ContentReports.Where(report => report.ReporterUserId == reporter && report.TargetType == type && report.TargetId == targetId).Select(report => report.Id).FirstAsync();

    private async Task<long> ReportCollectionAsync(long reporter, long collectionId)
    {
        await Reports().CreateAsync(reporter, new CreateReportCommand("Collection", collectionId.ToString(), null, "Spam", Marker));
        return await ReportIdAsync(reporter, ReportTargetType.Collection, collectionId);
    }

    private Task<Juple.Application.Collections.Access.CollectionAccess?> AccessAsync(long user, long collectionId) =>
        new CollectionAccessStore(NewContext()).FindAsync(user, collectionId);

    // ---------- reports ----------

    [Fact]
    public async Task Report_KeepsASnapshot_AndIsNotDuplicatedWhileOpenOrInReview()
    {
        var (owner, _) = await NewUserAsync();
        var (member, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);

        var first = await Reports().CreateAsync(member, new CreateReportCommand("Collection", collection.ToString(), null, "Spam", Marker));
        Assert.False(first.AlreadyReported);
        var id = await ReportIdAsync(member, ReportTargetType.Collection, collection);
        var stored = await NewContext().ContentReports.SingleAsync(report => report.Id == id);
        Assert.StartsWith("Moderation", stored.SnapshotTitle);

        Assert.True((await Reports().CreateAsync(member, new CreateReportCommand("Collection", collection.ToString(), null, "Other", Marker))).AlreadyReported);
        await Admin().ChangeStatusAsync(owner, id, "InReview", null);
        Assert.True((await Reports().CreateAsync(member, new CreateReportCommand("Collection", collection.ToString(), null, "Other", Marker))).AlreadyReported);
        Assert.Equal(1, await NewContext().ContentReports.CountAsync(report => report.ReporterUserId == member && report.TargetId == collection));
    }

    [Fact]
    public async Task Report_OwnContentAndUnseenContent_AreRefused()
    {
        var (owner, _) = await NewUserAsync();
        var (member, _) = await NewUserAsync();
        var (stranger, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);
        var mine = await NewItemInAsync(member, collection);

        await Assert.ThrowsAsync<ReportOwnContentException>(() => Reports().CreateAsync(owner, new CreateReportCommand("Collection", collection.ToString(), null, "Spam", Marker)));
        await Assert.ThrowsAsync<ReportOwnContentException>(() => Reports().CreateAsync(member, new CreateReportCommand("Item", mine.ToString(), collection, "Spam", Marker)));
        await Assert.ThrowsAsync<ReportTargetNotFoundException>(() => Reports().CreateAsync(stranger, new CreateReportCommand("Collection", collection.ToString(), null, "Spam", Marker)));
    }

    [Fact]
    public async Task PublicShareReport_NeedsAPublicLink_AndTheOwnerCannotReportTheirOwn()
    {
        var (owner, _) = await NewUserAsync();
        var (visitor, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner);
        var privateId = await _db.CollectionShares.Where(share => share.CollectionId == collection).Select(share => share.PublicId).FirstAsync();

        await Assert.ThrowsAsync<ReportTargetNotFoundException>(() => Reports().CreateForPublicShareAsync(visitor, privateId, "Spam", Marker));

        var publicId = await MakePublicAsync(collection);
        Assert.False((await Reports().CreateForPublicShareAsync(visitor, publicId, "Spam", Marker)).AlreadyReported);
        await Assert.ThrowsAsync<ReportOwnContentException>(() => Reports().CreateForPublicShareAsync(owner, publicId, "Spam", Marker));
    }

    // ---------- blocks ----------

    [Fact]
    public async Task Block_HidesTheOwnersCollectionFromMyLists_ButKeepsMembershipLinksAndDirectAccess()
    {
        var (owner, ownerCode) = await NewUserAsync();
        var (member, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);
        var ownersLink = await NewItemInAsync(owner, collection);

        await Blocks().BlockAsync(member, ownerCode);

        var list = await new CollectionStore(NewContext()).ListByScopeAsync(member, CollectionListScope.Shared, null, null, null, 50);
        Assert.DoesNotContain(list.Items, entry => entry.Id == collection);
        Assert.Equal(collection, (await new CollectionStore(NewContext()).GetAsync(member, collection)).Id);
        Assert.True(await NewContext().CollectionCollaborators.AnyAsync(entry => entry.CollectionId == collection && entry.UserId == member));
        Assert.NotNull(await new CollectionStore(NewContext()).GetSharedItemAsync(member, collection, ownersLink));
        Assert.NotNull(await new CollectionStore(NewContext()).GetSharedItemAsync(owner, collection, ownersLink));

        var blocked = await Blocks().ListAsync(member);
        Assert.Equal(collection, Assert.Single(Assert.Single(blocked).HiddenCollections).Id);

        await Blocks().UnblockAsync(member, ownerCode);
        list = await new CollectionStore(NewContext()).ListByScopeAsync(member, CollectionListScope.Shared, null, null, null, 50);
        Assert.Contains(list.Items, entry => entry.Id == collection);
    }

    [Fact]
    public async Task Block_DoesNotHideAnythingFromTheBlockedPerson()
    {
        var (owner, _) = await NewUserAsync();
        var (member, memberCode) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);

        await Blocks().BlockAsync(owner, memberCode);

        var list = await new CollectionStore(NewContext()).ListByScopeAsync(member, CollectionListScope.Shared, null, null, null, 50);
        Assert.Contains(list.Items, entry => entry.Id == collection);
        Assert.Empty(await Blocks().ListAsync(member));
    }

    // ---------- share restriction ----------

    [Fact]
    public async Task Restriction_ShutsOutMembersAndThePublicLink_OwnerKeepsIt_AndLiftingRestoresAll()
    {
        var (owner, _) = await NewUserAsync();
        var (member, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);
        var link = await NewItemInAsync(owner, collection);
        var publicId = await MakePublicAsync(collection);
        var report = await ReportCollectionAsync(member, collection);

        var detail = await Admin().RestrictAsync(admin, report, "note");

        Assert.True(detail.IsRestricted);
        Assert.Null(await AccessAsync(member, collection));
        Assert.NotNull(await AccessAsync(owner, collection));
        Assert.True((await new CollectionStore(NewContext()).GetAsync(owner, collection)).IsShareRestricted);
        Assert.Null(await new PublicShareMembershipStore(NewContext()).GetAsync(publicId, member));
        Assert.NotNull(await new PublicShareMembershipStore(NewContext()).GetAsync(publicId, owner));
        Assert.Null(await new PublicCollectionStore(NewContext()).GetStateAsync(publicId));
        var list = await new CollectionStore(NewContext()).ListByScopeAsync(member, CollectionListScope.Shared, null, null, null, 50);
        Assert.DoesNotContain(list.Items, entry => entry.Id == collection);
        Assert.True(await NewContext().Items.AnyAsync(item => item.Id == link && item.DeletedAtUtc == null));
        Assert.True(await NewContext().CollectionCollaborators.AnyAsync(entry => entry.CollectionId == collection && entry.UserId == member));

        await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().ChangeStatusAsync(admin, report, "Dismissed", null));

        var lifted = await Admin().LiftRestrictionAsync(admin, report, null);
        Assert.False(lifted.IsRestricted);
        Assert.NotNull(await AccessAsync(member, collection));
        Assert.NotNull(await new PublicCollectionStore(NewContext()).GetStateAsync(publicId));
        Assert.Equal(2, await NewContext().AdminAuditLogs.CountAsync(log => log.TargetType == Juple.Domain.Admin.AdminAuditTargets.ContentReport && log.TargetId == report.ToString()));
    }

    [Fact]
    public async Task Restriction_OfOneLink_HidesItFromOtherMembers_ButNotFromItsAdderOrTheOwner()
    {
        var (owner, _) = await NewUserAsync();
        var (adder, _) = await NewUserAsync();
        var (other, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, adder, other);
        var link = await NewItemInAsync(adder, collection);
        await Reports().CreateAsync(other, new CreateReportCommand("Item", link.ToString(), collection, "Spam", Marker));
        var report = await ReportIdAsync(other, ReportTargetType.Item, link);

        await Admin().RestrictAsync(admin, report, null);

        Assert.Null(await new CollectionStore(NewContext()).GetSharedItemAsync(other, collection, link));
        Assert.NotNull(await new CollectionStore(NewContext()).GetSharedItemAsync(adder, collection, link));
        Assert.NotNull(await new CollectionStore(NewContext()).GetSharedItemAsync(owner, collection, link));
        Assert.NotNull(await AccessAsync(other, collection));
    }

    [Fact]
    public async Task Restriction_OfAPersonIsRefused()
    {
        var (owner, ownerCode) = await NewUserAsync();
        var (member, _) = await NewUserAsync();
        var (admin, _) = await NewUserAsync();
        await NewCollectionAsync(owner, member);
        await Reports().CreateAsync(member, new CreateReportCommand("User", ownerCode, null, "Spam", Marker));
        var report = await ReportIdAsync(member, ReportTargetType.User, owner);

        await Assert.ThrowsAsync<AdminReportConflictException>(() => Admin().RestrictAsync(admin, report, null));
        await _db.ContentReports.Where(entry => entry.Id == report).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task AdminList_ShowsTheOpenReport_AndDetailCarriesPriorReports()
    {
        var (owner, _) = await NewUserAsync();
        var (first, _) = await NewUserAsync();
        var (second, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, first, second);
        var a = await ReportCollectionAsync(first, collection);
        var b = await ReportCollectionAsync(second, collection);

        var page = await Admin().ListAsync("Open", null, 100);
        Assert.Contains(page.Items, entry => entry.ReportId == b);
        var detail = await Admin().GetAsync(b);
        Assert.Contains(detail.PriorReports, entry => entry.ReportId == a);
        Assert.Equal(first, (await Admin().GetAsync(a)).Reporter?.UserId);
    }

    // ---------- the automatic check ----------

    [Fact]
    public async Task AutoFilter_RaisesOneOpenReviewReport_WithoutReporterAndWithoutDeleting()
    {
        var (owner, _) = await NewUserAsync();
        var (member, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);
        var report = ContentReport.FromAutoFilter(ReportTargetType.Collection, collection, owner, collection, "autoFilter:manyUrls", DateTimeOffset.UtcNow, "name", null);
        var again = ContentReport.FromAutoFilter(ReportTargetType.Collection, collection, owner, collection, "autoFilter:manyUrls", DateTimeOffset.UtcNow, "name", null);

        await new SafetyStore(NewContext()).AddAutoFilterReportAsync(report);
        await new SafetyStore(NewContext()).AddAutoFilterReportAsync(again);

        var rows = await NewContext().ContentReports.Where(entry => entry.CollectionId == collection && entry.Source == ReportSource.AutoFilter).ToListAsync();
        Assert.Null(Assert.Single(rows).ReporterUserId);
    }

    // ---------- account deletion ----------

    [Fact]
    public async Task AccountDeletion_KeepsTheReportAnonymously_AndDropsTheDeletedPersonsSnapshot()
    {
        var (owner, _) = await NewUserAsync();
        var (member, _) = await NewUserAsync();
        var collection = await NewCollectionAsync(owner, member);
        var link = await NewItemInAsync(member, collection);
        await Reports().CreateAsync(owner, new CreateReportCommand("Item", link.ToString(), collection, "Spam", Marker));
        var report = await ReportIdAsync(owner, ReportTargetType.Item, link);

        await new AccountDeletionStore(NewContext()).DeleteAllDataAsync(member, $"test/moderation/{member}/", DateTimeOffset.UtcNow);
        _userIds.Remove(member);

        var stored = await NewContext().ContentReports.SingleAsync(entry => entry.Id == report);
        Assert.Null(stored.TargetUserId);
        Assert.Null(stored.SnapshotUrl);
        Assert.Null(stored.SnapshotTitle);
    }
}
