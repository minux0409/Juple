using System.Reflection;
using Juple.Application.Billing;
using Juple.Application.Collections;
using Juple.Application.Collections.Submissions;
using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// CollectionItem.VisibleSinceUtc - when a membership became visible content of ITS Collection - against the real schema.
/// Every creation path stamps it from the authoritative operation time (direct add, approved proposal, copy-in, move/merge
/// target, restored membership) while AddedAtUtc keeps its existing browsing/history meaning; the subscription freeze reads
/// only VisibleSinceUtc. Nothing here is visible to a user: browsing, ordering and dates are asserted unchanged.
/// </summary>
public sealed class CollectionItemVisibleSinceIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Old = new(2026, 6, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Operation = new(2026, 12, 20, 12, 0, 0, TimeSpan.Zero);

    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private long _owner;
    private long _member;
    private long _a;
    private long _b;
    private long _shared;

    private sealed class StubTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);
        var owner = new User("ko-KR", "Asia/Seoul", null, Old, Old);
        var member = new User("ko-KR", "Asia/Seoul", null, Old, Old);
        _db.Users.AddRange(owner, member);
        await _db.SaveChangesAsync();
        (_owner, _member) = (owner.Id, member.Id);
        var store = new CollectionStore(_db);
        _a = (await store.CreateAsync(_owner, "A", "A", CollectionIcon.Folder, Old)).Id;
        _b = (await store.CreateAsync(_owner, "B", "B", CollectionIcon.Folder, Old)).Id;
        _shared = (await store.CreateAsync(_owner, "Shared", "SHARED", CollectionIcon.Folder, Old)).Id;
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in new[] { _owner, _member })
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var item = new Item(userId, url, Old);
        _db.Items.Add(item);
        await _db.SaveChangesAsync();
        return item.Id;
    }

    private async Task<CollectionItem> MembershipAsync(long collectionId, long itemId) =>
        await _db.CollectionItems.AsNoTracking().SingleAsync(entry => entry.CollectionId == collectionId && entry.ItemId == itemId);

    /// <summary>The invariant every membership must satisfy, whichever path created it.</summary>
    private static void AssertStamped(CollectionItem membership)
    {
        Assert.NotEqual(default, membership.VisibleSinceUtc);
        Assert.True(membership.VisibleSinceUtc >= membership.AddedAtUtc, "A membership cannot have become visible before its browsing time.");
    }

    private async Task<bool> VisibleThroughAsync(long collectionId, long itemId, DateTimeOffset freeze) =>
        await _db.CollectionItems.AsNoTracking()
            .Where(entry => entry.CollectionId == collectionId && entry.ItemId == itemId)
            .WhereVisibleThrough(freeze)
            .AnyAsync();

    // ---------------------------------------------------------------- schema

    private const string CompatDefaultName = "DF_CollectionItems_VisibleSinceUtc_RollingCompat";

    [Fact]
    public async Task ThePhysicalColumn_IsNotNull_DatetimeOffset_WithTheNamedRollingCompatDefault_AndNoIndex()
    {
        var column = (await _db.Database.SqlQueryRaw<string>(
            "SELECT t.name + '|' + CAST(c.is_nullable AS varchar(1)) AS [Value] FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE c.object_id = OBJECT_ID('collections.CollectionItems') AND c.name = 'VisibleSinceUtc'")
            .ToListAsync()).Single();
        var defaults = await _db.Database.SqlQueryRaw<string>(
            "SELECT d.name + '|' + d.definition AS [Value] FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id WHERE d.parent_object_id = OBJECT_ID('collections.CollectionItems') AND c.name = 'VisibleSinceUtc'")
            .ToListAsync();
        var indexes = (await _db.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*) AS [Value] FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id WHERE ic.object_id = OBJECT_ID('collections.CollectionItems') AND c.name = 'VisibleSinceUtc'")
            .ToListAsync()).Single();
        var addedAt = (await _db.Database.SqlQueryRaw<int>(
            "SELECT COUNT(*) AS [Value] FROM sys.columns WHERE object_id = OBJECT_ID('collections.CollectionItems') AND name = 'AddedAtUtc'")
            .ToListAsync()).Single();

        Assert.Equal("datetimeoffset|0", column);
        var compat = Assert.Single(defaults);
        Assert.StartsWith(CompatDefaultName + "|", compat, StringComparison.Ordinal);
        // An explicit UTC datetimeoffset expression - not GETDATE(), not local time.
        Assert.Contains("SYSUTCDATETIME", compat, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("TODATETIMEOFFSET", compat, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("+00:00", compat, StringComparison.Ordinal);
        Assert.DoesNotContain("GETDATE", compat, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(0, indexes);
        Assert.Equal(1, addedAt);
    }

    [Fact]
    public void TheEfModelHasNoDefaultForIt_TheDatabaseFallbackIsADeploymentArtifactOnly()
    {
        var property = _db.Model.FindEntityType(typeof(CollectionItem))!.FindProperty(nameof(CollectionItem.VisibleSinceUtc))!;

        Assert.False(property.IsNullable);
        Assert.Null(property.GetDefaultValueSql());
        Assert.Null(property.FindAnnotation(Microsoft.EntityFrameworkCore.Metadata.RelationalAnnotationNames.DefaultValue));
        Assert.Null(property.FindAnnotation(Microsoft.EntityFrameworkCore.Metadata.RelationalAnnotationNames.DefaultValueSql));
        Assert.Equal(Microsoft.EntityFrameworkCore.Metadata.ValueGenerated.Never, property.ValueGenerated);
    }

    [Fact]
    public async Task AnOldRevisionInsert_ThatOmitsTheColumn_Succeeds_StampedWithTheInsertInstantInUtc()
    {
        var item = await NewItemAsync(_owner, "https://example.test/old-revision");

        // Exactly the previous API revision's column set: no VisibleSinceUtc.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedAtUtc, SortOrder, AddedByUserId, AddedViaPublicShare) VALUES ({_a}, {item}, {Old}, 0, {_owner}, 0)");

        var row = (await _db.Database.SqlQuery<FallbackRow>(
            $"SELECT VisibleSinceUtc, DATEDIFF_BIG(millisecond, VisibleSinceUtc, SYSDATETIMEOFFSET()) AS AgeMs, DATEPART(tz, VisibleSinceUtc) AS OffsetMinutes FROM collections.CollectionItems WHERE CollectionId = {_a} AND ItemId = {item}").ToListAsync()).Single();
        Assert.NotEqual(default, row.VisibleSinceUtc);
        // The insert instant: within seconds of "now" on the database - and not the row's historic AddedAtUtc.
        Assert.InRange(row.AgeMs, 0, 60_000);
        Assert.NotEqual(Old, row.VisibleSinceUtc);
        // Stored as UTC (offset zero).
        Assert.Equal(0, row.OffsetMinutes);
    }

    [Fact]
    public async Task AnExplicitValue_IsStoredExactly_TheCompatDefaultNeverOverridesIt()
    {
        // Through a real creation path (the new revision's move target, which sets AddedAtUtc and VisibleSinceUtc apart) ...
        var item = await NewItemAsync(_owner, "https://example.test/explicit");
        await new CollectionStore(_db).AddAsync(_owner, _a, item, Old);
        var moveTime = new DateTimeOffset(2031, 5, 6, 7, 8, 9, 123, TimeSpan.Zero).AddTicks(4567);
        await new CollectionStore(_db, null, null, new StubTime(moveTime)).TransferItemAsync(_owner, _a, item, _b);
        Assert.Equal(moveTime, (await MembershipAsync(_b, item)).VisibleSinceUtc);

        // ... and through an INSERT that names the column.
        var other = await NewItemAsync(_owner, "https://example.test/explicit-raw");
        var explicitValue = new DateTimeOffset(2019, 1, 2, 3, 4, 5, TimeSpan.Zero);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedAtUtc, VisibleSinceUtc, SortOrder, AddedByUserId, AddedViaPublicShare) VALUES ({_a}, {other}, {Old}, {explicitValue}, 0, {_owner}, 0)");
        Assert.Equal(explicitValue, (await MembershipAsync(_a, other)).VisibleSinceUtc);
    }

    private sealed class FallbackRow
    {
        public DateTimeOffset VisibleSinceUtc { get; set; }

        public long AgeMs { get; set; }

        public int OffsetMinutes { get; set; }
    }

    [Fact]
    public void TheEntityConstructor_RequiresIt_SoNoCreationPathCanForgetIt()
    {
        var constructor = typeof(CollectionItem).GetConstructors(BindingFlags.Public | BindingFlags.Instance).Single();
        var parameter = constructor.GetParameters().Single(entry => entry.Name == "visibleSinceUtc");

        Assert.False(parameter.IsOptional);
        Assert.Equal(typeof(DateTimeOffset), parameter.ParameterType);
    }

    // ---------------------------------------------------------------- direct add

    [Fact]
    public async Task DirectAdd_StampsBothTimesWithTheCreationInstant_AndTheFreezeBoundaryDecidesVisibility()
    {
        var item = await NewItemAsync(_owner, "https://example.test/direct");
        var t1 = new DateTimeOffset(2026, 12, 10, 0, 0, 0, TimeSpan.Zero);

        Assert.True(await new CollectionStore(_db).AddAsync(_owner, _a, item, t1));

        var membership = await MembershipAsync(_a, item);
        Assert.Equal(t1, membership.AddedAtUtc);
        Assert.Equal(t1, membership.VisibleSinceUtc);
        AssertStamped(membership);
        Assert.True(await VisibleThroughAsync(_a, item, t1.AddDays(1)));
        Assert.True(await VisibleThroughAsync(_a, item, t1));
        Assert.False(await VisibleThroughAsync(_a, item, t1.AddDays(-1)));
    }

    [Fact]
    public async Task AddingAgain_ChangesNothing_VisibilityIsOnlyForANewMembership()
    {
        var item = await NewItemAsync(_owner, "https://example.test/again");
        var store = new CollectionStore(_db);
        await store.AddAsync(_owner, _a, item, Old);

        Assert.False(await store.AddAsync(_owner, _a, item, Operation));

        var membership = await MembershipAsync(_a, item);
        Assert.Equal(Old, membership.VisibleSinceUtc);
        Assert.Equal(Old, membership.AddedAtUtc);
    }

    // ---------------------------------------------------------------- proposal approval

    [Fact]
    public async Task AnApprovedProposal_IsVisibleSinceTheApproval_NotSinceTheProposal()
    {
        var item = await NewItemAsync(_member, "https://example.test/proposal");
        var submissions = new CollectionLinkSubmissionStore(_db);
        var t1 = new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);
        var t2 = new DateTimeOffset(2026, 12, 15, 0, 0, 0, TimeSpan.Zero);
        var t3 = new DateTimeOffset(2026, 12, 29, 0, 0, 0, TimeSpan.Zero);

        Assert.Equal(CollectionLinkAddOutcome.Submitted, await submissions.SubmitAsync(_member, _shared, item, null, t1));
        var submissionId = await _db.CollectionLinkSubmissions.AsNoTracking().Where(entry => entry.CollectionId == _shared).Select(entry => entry.Id).SingleAsync();
        await submissions.ApproveAsync(_shared, submissionId, t3);

        var membership = await MembershipAsync(_shared, item);
        Assert.Equal(t3, membership.VisibleSinceUtc);
        Assert.Equal(t3, membership.AddedAtUtc);
        AssertStamped(membership);
        // Proposed (T1) < frozen (T2) < approved (T3): new content after the freeze.
        Assert.False(await VisibleThroughAsync(_shared, item, t2));
        Assert.True(await VisibleThroughAsync(_shared, item, t3));
    }

    [Fact]
    public async Task TheOwnersOwnLink_GoesStraightIn_StampedAtTheAdd()
    {
        var item = await NewItemAsync(_owner, "https://example.test/owner-direct");

        Assert.Equal(CollectionLinkAddOutcome.Added, await new CollectionLinkSubmissionStore(_db).SubmitAsync(_owner, _shared, item, null, Operation));

        var membership = await MembershipAsync(_shared, item);
        Assert.Equal(Operation, membership.VisibleSinceUtc);
        AssertStamped(membership);
    }

    [Fact]
    public async Task AWritablePublicShareAdd_IsStampedAtTheAdd()
    {
        var share = new CollectionShare(_shared, Guid.NewGuid().ToString("N")[..16], Old);
        share.SetPermission(CollectionSharePermission.Write, Old);
        _db.CollectionShares.Add(share);
        await _db.SaveChangesAsync();
        var item = await NewItemAsync(_member, "https://example.test/public-write");

        Assert.True(await new CollectionStore(_db).AddItemAsync(share.PublicId, _member, item, Operation));

        var membership = await MembershipAsync(_shared, item);
        Assert.True(membership.AddedViaPublicShare);
        Assert.Equal(Operation, membership.AddedAtUtc);
        Assert.Equal(Operation, membership.VisibleSinceUtc);
        AssertStamped(membership);
    }

    // ---------------------------------------------------------------- copy

    [Fact]
    public async Task CopyIn_StampsTheTargetWithTheCopyTime_AndLeavesTheSourceMembershipUntouched()
    {
        var item = await NewItemAsync(_owner, "https://example.test/copy");
        await new CollectionStore(_db).AddAsync(_owner, _a, item, Old);
        var freeze = Old.AddDays(30);

        await new CollectionItemCopyStore(_db).CopyAsync(_owner, _a, [item], _b, Operation);

        var source = await MembershipAsync(_a, item);
        var target = await MembershipAsync(_b, item);
        Assert.Equal(Old, source.AddedAtUtc);
        Assert.Equal(Old, source.VisibleSinceUtc);
        // Today's behavior is kept: a copy-in is dated at the copy (AddedAtUtc = nowUtc); VisibleSinceUtc is the same instant.
        Assert.Equal(Operation, target.AddedAtUtc);
        Assert.Equal(Operation, target.VisibleSinceUtc);
        AssertStamped(target);
        Assert.True(await VisibleThroughAsync(_a, item, freeze));
        Assert.False(await VisibleThroughAsync(_b, item, freeze));
    }

    // ---------------------------------------------------------------- move (transfer) and its undo

    [Fact]
    public async Task Move_TheTargetKeepsTheOldBrowsingDate_ButBecameVisibleAtTheMoveTime()
    {
        var item = await NewItemAsync(_owner, "https://example.test/move");
        await new CollectionStore(_db).AddAsync(_owner, _a, item, Old);
        var freeze = Old.AddDays(30);

        await new CollectionStore(_db, null, null, new StubTime(Operation)).TransferItemAsync(_owner, _a, item, _b);

        var target = await MembershipAsync(_b, item);
        Assert.Equal(Old, target.AddedAtUtc);
        Assert.Equal(Operation, target.VisibleSinceUtc);
        AssertStamped(target);
        Assert.False(await VisibleThroughAsync(_b, item, freeze));
        Assert.Equal(0, await _db.CollectionItems.AsNoTracking().CountAsync(entry => entry.CollectionId == _a && entry.ItemId == item));
    }

    [Fact]
    public async Task Move_BrowsingStillUsesTheCarriedOverAddedAtUtc_NotVisibleSinceUtc()
    {
        var item = await NewItemAsync(_owner, "https://example.test/browse");
        var other = await NewItemAsync(_owner, "https://example.test/browse-other");
        var store = new CollectionStore(_db, null, null, new StubTime(Operation));
        await store.AddAsync(_owner, _a, item, Old);
        await store.AddAsync(_owner, _b, other, Old.AddDays(10));

        await store.TransferItemAsync(_owner, _a, item, _b);

        var (page, _, _) = await new CollectionStore(_db).GetItemsAsync(_owner, _b, null, 10, CollectionItemSort.DateDesc);
        // Date order and the date shown are the browsing time: the moved link (Old) still sorts BELOW the other (Old + 10 days),
        // although it became visible later (Operation).
        Assert.Equal([other, item], page.Items.Select(entry => entry.ItemId));
        Assert.Equal(Old, page.Items.Single(entry => entry.ItemId == item).AddedAtUtc);
    }

    [Fact]
    public async Task UndoingAMove_RestoresTheSourceMembershipStampedAtTheUndo()
    {
        var item = await NewItemAsync(_owner, "https://example.test/undo");
        await new CollectionStore(_db).AddAsync(_owner, _a, item, Old);
        var store = new CollectionStore(_db, null, null, new StubTime(Operation));
        var moved = await store.TransferItemAsync(_owner, _a, item, _b);

        var recreated = await store.UndoTransferItemAsync(_owner, _a, item, _b, moved.TargetMembershipCreated);

        Assert.True(recreated);
        var restored = await MembershipAsync(_a, item);
        Assert.Equal(Operation, restored.AddedAtUtc);
        Assert.Equal(Operation, restored.VisibleSinceUtc);
        AssertStamped(restored);
    }

    // ---------------------------------------------------------------- merge

    [Fact]
    public async Task Merge_TargetMembershipsGetTheMergeTime_KeepTheirBrowsingDate_AndTheSourceIsUntouched()
    {
        var item = await NewItemAsync(_owner, "https://example.test/merge");
        await new CollectionStore(_db).AddAsync(_owner, _a, item, Old);

        await new CollectionStore(_db, null, null, new StubTime(Operation)).MergeAsync(_owner, _a, _b);

        var target = await MembershipAsync(_b, item);
        var source = await MembershipAsync(_a, item);
        Assert.Equal(Old, target.AddedAtUtc);
        Assert.Equal(Operation, target.VisibleSinceUtc);
        AssertStamped(target);
        Assert.Equal(Old, source.AddedAtUtc);
        Assert.Equal(Old, source.VisibleSinceUtc);
    }

    // ---------------------------------------------------------------- migration of existing rows

    [Fact]
    public async Task TheMigration_BackfillsExistingRowsFromAddedAtUtc_AndEndsNotNull()
    {
        var builder = new SqlConnectionStringBuilder(_connectionString);
        builder.InitialCatalog = $"{builder.InitialCatalog}_VisibleSince_{Guid.NewGuid():N}";
        await using var db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(builder.ConnectionString).Options);
        try
        {
            var migrator = db.GetService<IMigrator>();
            // The schema as it was BEFORE this column: the previous migration.
            await migrator.MigrateAsync("20261007095246_AddSupportInquiries");

            var t1 = new DateTimeOffset(2026, 3, 4, 5, 6, 7, TimeSpan.Zero);
            var t2 = new DateTimeOffset(2025, 11, 30, 23, 59, 58, TimeSpan.Zero);
            var code = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
            var userId = (await db.Database.SqlQuery<long>(
                $"INSERT INTO users.Users (PreferredLocale, TimeZoneId, CreatedAtUtc, UpdatedAtUtc, PublicCode) OUTPUT INSERTED.Id AS [Value] VALUES ('ko-KR', 'UTC', {t1}, {t1}, {code})").ToListAsync()).Single();
            var collectionId = (await db.Database.SqlQuery<long>(
                $"INSERT INTO collections.Collections (UserId, Name, NameNormalized, CreatedAtUtc, UpdatedAtUtc) OUTPUT INSERTED.Id AS [Value] VALUES ({userId}, 'C', 'C', {t1}, {t1})").ToListAsync()).Single();
            var itemIds = new List<long>();
            foreach (var (url, addedAt) in new[] { ("https://example.test/m1", t1), ("https://example.test/m2", t2) })
            {
                var itemId = (await db.Database.SqlQuery<long>(
                    $"INSERT INTO items.Items (UserId, Url, SavedAtUtc) OUTPUT INSERTED.Id AS [Value] VALUES ({userId}, {url}, {addedAt})").ToListAsync()).Single();
                itemIds.Add(itemId);
                await db.Database.ExecuteSqlInterpolatedAsync(
                    $"INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedAtUtc, SortOrder, AddedByUserId, AddedViaPublicShare) VALUES ({collectionId}, {itemId}, {addedAt}, 0, {userId}, 0)");
            }

            await migrator.MigrateAsync();

            // The migration runs "later" (now, in 2026+): the compat default must not have touched the historic rows.
            var migratedAt = DateTimeOffset.UtcNow;
            var rows = await db.Database.SqlQuery<MigratedRow>(
                $"SELECT ItemId, AddedAtUtc, VisibleSinceUtc FROM collections.CollectionItems WHERE CollectionId = {collectionId} ORDER BY ItemId").ToListAsync();
            Assert.Equal(2, rows.Count);
            Assert.Equal([t1, t2], rows.Select(row => row.VisibleSinceUtc));
            Assert.All(rows, row => Assert.Equal(row.AddedAtUtc, row.VisibleSinceUtc));
            Assert.All(rows, row => Assert.True(row.VisibleSinceUtc < migratedAt.AddDays(-30), "A historic row must never be stamped with the migration time."));
            var nullable = (await db.Database.SqlQuery<int>(
                $"SELECT CAST(is_nullable AS int) AS [Value] FROM sys.columns WHERE object_id = OBJECT_ID('collections.CollectionItems') AND name = 'VisibleSinceUtc'").ToListAsync()).Single();
            Assert.Equal(0, nullable);

            // Rolling window: right after migrating, the PREVIOUS revision (no VisibleSinceUtc in its INSERT) still writes.
            var lateItem = (await db.Database.SqlQuery<long>(
                $"INSERT INTO items.Items (UserId, Url, SavedAtUtc) OUTPUT INSERTED.Id AS [Value] VALUES ({userId}, 'https://example.test/m3', {t1})").ToListAsync()).Single();
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedAtUtc, SortOrder, AddedByUserId, AddedViaPublicShare) VALUES ({collectionId}, {lateItem}, {t1}, 0, {userId}, 0)");
            var fallback = (await db.Database.SqlQuery<DateTimeOffset>(
                $"SELECT VisibleSinceUtc AS [Value] FROM collections.CollectionItems WHERE CollectionId = {collectionId} AND ItemId = {lateItem}").ToListAsync()).Single();
            Assert.True(fallback > migratedAt.AddMinutes(-5) && fallback < migratedAt.AddMinutes(5));
        }
        finally
        {
            await db.Database.EnsureDeletedAsync();
        }
    }

    [Fact]
    public async Task TheMigration_GoesDown_AndUpAgain_WithTheNamedDefaultNeverBlockingTheDowngrade()
    {
        var builder = new SqlConnectionStringBuilder(_connectionString);
        builder.InitialCatalog = $"{builder.InitialCatalog}_VisibleSinceDown_{Guid.NewGuid():N}";
        await using var db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(builder.ConnectionString).Options);
        try
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync();
            Assert.Equal(1, await DefaultCountAsync(db));

            // latest -> the previous migration: Down drops the named default BEFORE the column.
            await migrator.MigrateAsync("20261007095246_AddSupportInquiries");
            Assert.Equal(0, await ColumnCountAsync(db, "collections", "CollectionItems", "VisibleSinceUtc"));
            Assert.Equal(0, await DefaultCountAsync(db));
            Assert.Equal(0, await ColumnCountAsync(db, "users", "Users", "TrialStartedAtUtc"));
            Assert.Equal(0, (await db.Database.SqlQuery<int>($"SELECT COUNT(*) AS [Value] FROM sys.tables WHERE name = 'TrialLedger'").ToListAsync()).Single());

            // data written while down is backfilled again on the way back up
            var t1 = new DateTimeOffset(2026, 2, 3, 4, 5, 6, TimeSpan.Zero);
            var code = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();
            var userId = (await db.Database.SqlQuery<long>(
                $"INSERT INTO users.Users (PreferredLocale, TimeZoneId, CreatedAtUtc, UpdatedAtUtc, PublicCode) OUTPUT INSERTED.Id AS [Value] VALUES ('ko-KR', 'UTC', {t1}, {t1}, {code})").ToListAsync()).Single();
            var collectionId = (await db.Database.SqlQuery<long>(
                $"INSERT INTO collections.Collections (UserId, Name, NameNormalized, CreatedAtUtc, UpdatedAtUtc) OUTPUT INSERTED.Id AS [Value] VALUES ({userId}, 'C', 'C', {t1}, {t1})").ToListAsync()).Single();
            var itemId = (await db.Database.SqlQuery<long>(
                $"INSERT INTO items.Items (UserId, Url, SavedAtUtc) OUTPUT INSERTED.Id AS [Value] VALUES ({userId}, 'https://example.test/d1', {t1})").ToListAsync()).Single();
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedAtUtc, SortOrder, AddedByUserId, AddedViaPublicShare) VALUES ({collectionId}, {itemId}, {t1}, 0, {userId}, 0)");

            await migrator.MigrateAsync();

            Assert.Equal(1, await DefaultCountAsync(db));
            var visibleSince = (await db.Database.SqlQuery<DateTimeOffset>(
                $"SELECT VisibleSinceUtc AS [Value] FROM collections.CollectionItems WHERE ItemId = {itemId}").ToListAsync()).Single();
            Assert.Equal(t1, visibleSince);
        }
        finally
        {
            await db.Database.EnsureDeletedAsync();
        }
    }

    private static async Task<int> DefaultCountAsync(JupleDbContext db) =>
        (await db.Database.SqlQuery<int>(
            $"SELECT COUNT(*) AS [Value] FROM sys.default_constraints WHERE name = 'DF_CollectionItems_VisibleSinceUtc_RollingCompat' AND parent_object_id = OBJECT_ID('collections.CollectionItems')").ToListAsync()).Single();

    private static async Task<int> ColumnCountAsync(JupleDbContext db, string schema, string table, string column) =>
        (await db.Database.SqlQuery<int>(
            $"SELECT COUNT(*) AS [Value] FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = {schema} AND t.name = {table} AND c.name = {column}").ToListAsync()).Single();

    private sealed class MigratedRow
    {
        public long ItemId { get; set; }

        public DateTimeOffset AddedAtUtc { get; set; }

        public DateTimeOffset VisibleSinceUtc { get; set; }
    }
}
