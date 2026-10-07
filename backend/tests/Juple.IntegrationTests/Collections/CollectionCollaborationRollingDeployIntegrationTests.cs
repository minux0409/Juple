using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// The expand/contract pair AddCollectionCollaborationAndLocking (expand) and
/// FinalizeCollectionCollaborationRequiredFields (contract), replayed the way a rolling deployment
/// runs them: the previous API revision - which knows nothing about Users.PublicCode or
/// CollectionItems.AddedByUserId - must keep writing after the expand migration, the new code must
/// cope with the rows it wrote, and the contract migration must finish them or refuse. Each test
/// uses its own throwaway database (the shared one is always at the latest migration).
/// </summary>
public sealed class CollectionCollaborationRollingDeployIntegrationTests : IAsyncLifetime
{
    private const string BeforeExpand = "20260922121559_AddCollectionMergeUndo";
    private const string Expand = "20260926021655_AddCollectionCollaborationAndLocking";
    private const string Contract = "20260926064534_FinalizeCollectionCollaborationRequiredFields";
    private const string FavoritesAndDisplayName = "20260926084045_AddCollectionFavoritesAndUserDisplayName";
    private const string JupleIdAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

    private string _connectionString = null!;

    public Task InitializeAsync()
    {
        var baseConnectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        var builder = new SqlConnectionStringBuilder(baseConnectionString);
        builder.InitialCatalog = $"{builder.InitialCatalog}_RollingDeploy_{Guid.NewGuid():N}";
        _connectionString = builder.ConnectionString;
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await using var db = NewContext();
        await db.Database.EnsureDeletedAsync();
    }

    [Fact]
    public async Task PreviousRevision_KeepsWritingAfterExpand_AndContractFinishesItsRows()
    {
        await MigrateToAsync(BeforeExpand);
        var owner = await OldRevisionInsertUserAsync();
        var collection = await OldRevisionInsertCollectionAsync(owner, "Groceries");
        var legacyItem = await OldRevisionInsertItemAsync(owner, "https://example.test/legacy");
        var legacyMembership = await OldRevisionInsertCollectionItemAsync(collection, legacyItem, sortOrder: 0);

        await MigrateToAsync(Expand);

        // Existing rows are backfilled by the expand migration itself.
        Assert.True(IsJupleId(await ScalarAsync<string>($"SELECT [PublicCode] AS [Value] FROM [users].[Users] WHERE [Id] = {owner}")));
        Assert.Equal(owner, await ScalarAsync<long?>($"SELECT [AddedByUserId] AS [Value] FROM [collections].[CollectionItems] WHERE [Id] = {legacyMembership}"));

        // The previous revision's writes, exactly as it issues them (no new columns), still succeed.
        var userFromOldRevision = await OldRevisionInsertUserAsync();
        var toRemove = await OldRevisionInsertCollectionItemAsync(collection, await OldRevisionInsertItemAsync(owner, "https://example.test/a"), sortOrder: -1);
        var toKeep = await OldRevisionInsertCollectionItemAsync(collection, await OldRevisionInsertItemAsync(owner, "https://example.test/b"), sortOrder: -2);
        var toMove = await OldRevisionInsertItemAsync(owner, "https://example.test/c");
        await OldRevisionInsertCollectionItemAsync(collection, toMove, sortOrder: -3);

        // A user created by the previous revision still gets a Juple ID (transitional DEFAULT).
        Assert.True(IsJupleId(await ScalarAsync<string>($"SELECT [PublicCode] AS [Value] FROM [users].[Users] WHERE [Id] = {userFromOldRevision}")));
        // An association from the previous revision holds the transitional 0 (never NULL: the new
        // revision maps the column as required), which matches no real user.
        Assert.Equal(0L, await ScalarAsync<long?>($"SELECT [AddedByUserId] AS [Value] FROM [collections].[CollectionItems] WHERE [Id] = {toKeep}"));

        // The new revision reads, reorders and removes those rows without failing, and its own
        // writes always record who added the link. That revision is played by today's model, which
        // also maps CollectionItems.AddedViaPublicShare (a later, purely additive migration) - so
        // this block gets exactly that column (with its migration's default) and gives it back
        // afterwards, leaving the real migration to add it. The same goes for CollectionItems.VisibleSinceUtc (also a later
        // migration): the model maps it, and the new revision's own AddAsync sets it explicitly.
        await ExecuteAsync(
            "ALTER TABLE [collections].[CollectionItems] ADD [AddedViaPublicShare] bit NOT NULL CONSTRAINT [DF_RollingDeploy_AddedViaPublicShare] DEFAULT CAST(0 AS bit)");
        await ExecuteAsync(
            "ALTER TABLE [collections].[CollectionItems] ADD [VisibleSinceUtc] datetimeoffset NOT NULL CONSTRAINT [DF_RollingDeploy_VisibleSinceUtc] DEFAULT SYSUTCDATETIME()");
        await using (var db = NewContext())
        {
            var store = new CollectionStore(db);
            var (page, _, _) = await store.GetItemsAsync(owner, collection, null, 50);
            Assert.Equal(4, page.Items.Count);

            await store.MoveItemAsync(owner, collection, toMove, afterItemId: null);
            var removedItemId = await ScalarAsync<long>($"SELECT [ItemId] AS [Value] FROM [collections].[CollectionItems] WHERE [Id] = {toRemove}");
            await store.RemoveAsync(owner, collection, removedItemId);

            var newItem = await OldRevisionInsertItemAsync(owner, "https://example.test/new-revision");
            await store.AddAsync(owner, collection, newItem, DateTimeOffset.UtcNow);
            Assert.Equal(owner, await ScalarAsync<long?>(
                $"SELECT [AddedByUserId] AS [Value] FROM [collections].[CollectionItems] WHERE [CollectionId] = {collection} AND [ItemId] = {newItem}"));
        }

        await ExecuteAsync(
            "ALTER TABLE [collections].[CollectionItems] DROP CONSTRAINT [DF_RollingDeploy_AddedViaPublicShare]; ALTER TABLE [collections].[CollectionItems] DROP COLUMN [AddedViaPublicShare]");
        await ExecuteAsync(
            "ALTER TABLE [collections].[CollectionItems] DROP CONSTRAINT [DF_RollingDeploy_VisibleSinceUtc]; ALTER TABLE [collections].[CollectionItems] DROP COLUMN [VisibleSinceUtc]");

        await MigrateToAsync(null);

        Assert.Equal(0, await ScalarAsync<int>("SELECT COUNT(*) AS [Value] FROM [collections].[CollectionItems] WHERE [AddedByUserId] IS NULL OR [AddedByUserId] = 0"));
        Assert.Equal(owner, await ScalarAsync<long?>($"SELECT [AddedByUserId] AS [Value] FROM [collections].[CollectionItems] WHERE [Id] = {toKeep}"));
        Assert.Equal(0, await ScalarAsync<int>("SELECT COUNT(*) AS [Value] FROM [users].[Users] WHERE [PublicCode] IS NULL"));
        Assert.False(await IsNullableAsync("users", "Users", "PublicCode"));
        Assert.False(await IsNullableAsync("collections", "CollectionItems", "AddedByUserId"));
        Assert.False(await RollingDeployDefaultExistsAsync());
        Assert.Equal(1, await ScalarAsync<int>(
            "SELECT COUNT(*) AS [Value] FROM sys.foreign_keys WHERE [name] = 'FK_CollectionItems_Users_AddedByUserId' AND [is_not_trusted] = 0"));
        Assert.Equal(1, await ScalarAsync<int>(
            "SELECT COUNT(*) AS [Value] FROM sys.indexes WHERE [name] = 'UX_Users_PublicCode' AND [is_unique] = 1 AND [has_filter] = 0"));

        // Down: the contract reverts to the exact expand state (old-revision writes work again),
        // and the expand reverts to the pre-collaboration schema.
        await MigrateToAsync(Expand);
        Assert.True(await IsNullableAsync("collections", "CollectionItems", "AddedByUserId"));
        Assert.True(await RollingDeployDefaultExistsAsync());
        Assert.True(IsJupleId(await ScalarAsync<string>($"SELECT [PublicCode] AS [Value] FROM [users].[Users] WHERE [Id] = {await OldRevisionInsertUserAsync()}")));

        await MigrateToAsync(BeforeExpand);
        Assert.Equal(0, await ScalarAsync<int>(
            "SELECT COUNT(*) AS [Value] FROM INFORMATION_SCHEMA.COLUMNS WHERE [COLUMN_NAME] IN ('PublicCode', 'AddedByUserId')"));
    }

    [Fact]
    public async Task Contract_RefusesAndChangesNothing_WhenANullRowCannotBeAttributedToTheOwner()
    {
        await MigrateToAsync(Expand);
        var owner = await OldRevisionInsertUserAsync();
        var someoneElse = await OldRevisionInsertUserAsync();
        var collection = await OldRevisionInsertCollectionAsync(owner, "Groceries");
        var foreignItem = await OldRevisionInsertItemAsync(someoneElse, "https://example.test/not-the-owners");
        await OldRevisionInsertCollectionItemAsync(collection, foreignItem, sortOrder: 0);

        var error = await Assert.ThrowsAsync<SqlException>(() => MigrateToAsync(null));

        Assert.Equal(50004, error.Number);
        await using var db = NewContext();
        Assert.DoesNotContain(Contract, await db.Database.GetAppliedMigrationsAsync());
        Assert.True(await IsNullableAsync("collections", "CollectionItems", "AddedByUserId"));
        Assert.True(await RollingDeployDefaultExistsAsync());
    }

    /// <summary>
    /// The favorites expand/contract pair replayed as a rolling deployment: the previous revision
    /// only ever reads/writes Collections.IsFavorite, the new one keeps an Owner's mark in both places
    /// and a Contributor's only in CollectionFavorites. At no point may either revision's change be
    /// lost, and the contract leaves CollectionFavorites complete and in agreement.
    /// </summary>
    [Fact]
    public async Task FavoritesTransition_NeverLosesAChange_FromEitherRevision_AndTheContractReconciles()
    {
        // 1. Old schema (DEV today): the collaboration contract applied, Round 2 not yet.
        await MigrateToAsync(Contract);
        var owner = await CurrentRevisionInsertUserAsync();
        var contributor = await CurrentRevisionInsertUserAsync();
        var starredLater = await OldRevisionInsertCollectionAsync(owner, "Starred later");
        var unstarredLater = await OldRevisionInsertCollectionAsync(owner, "Unstarred later");
        await OldRevisionSetFavoriteAsync(unstarredLater, true);

        // 2. Expand: the existing Owner favorite is backfilled.
        await MigrateToAsync(FavoritesAndDisplayName);
        Assert.True(await HasFavoriteRowAsync(owner, unstarredLater));

        // The new revision is played by today's model, which also maps Collections.IconImageBlobName
        // (a later, purely additive nullable column - AddCollectionIconImage) and reads the later
        // CollectionSharePasswords (AddCollectionSharePasswords) and CollectionLinkSubmissions
        // (AddCollectionLinkSubmissions - the Owner's 승인 대기 count) tables, and Notifications.CollectionId
        // (a later nullable column - the caller's unread 새 링크 count on each card): all are added here the
        // way those migrations add them and given back before the real migrations run in step 10.
        await ExecuteAsync("ALTER TABLE [collections].[Collections] ADD [IconImageBlobName] nvarchar(400) NULL");
        await ExecuteAsync("ALTER TABLE [notifications].[Notifications] ADD [CollectionId] bigint NULL");
        await ExecuteAsync(
            """
            CREATE TABLE [collections].[CollectionSharePasswords] (
                [Id] bigint NOT NULL IDENTITY PRIMARY KEY, [CollectionId] bigint NOT NULL, [Mode] varchar(20) NOT NULL,
                [PasswordHash] nvarchar(512) NULL, [EncryptedPassword] varchar(512) NULL, [PasswordVersion] int NOT NULL,
                [CreatedAtUtc] datetimeoffset NOT NULL, [UpdatedAtUtc] datetimeoffset NOT NULL)
            """);
        await ExecuteAsync(
            """
            CREATE TABLE [collections].[CollectionLinkSubmissions] (
                [Id] bigint NOT NULL IDENTITY PRIMARY KEY, [CollectionId] bigint NOT NULL, [ItemId] bigint NOT NULL,
                [SubmittedByUserId] bigint NOT NULL, [ViaPublicShare] bit NOT NULL, [Url] nvarchar(max) NOT NULL,
                [UrlHash] binary(32) NOT NULL, [Title] nvarchar(500) NULL, [PreviewImageUrl] nvarchar(max) NULL,
                [CreatedAtUtc] datetimeoffset NOT NULL)
            """);

        // 3-4. The previous revision stars a Collection (legacy column only) - the new revision
        // already shows it as the Owner's favorite: nothing it wrote is missed.
        await OldRevisionSetFavoriteAsync(starredLater, true);
        Assert.True(await IsFavoriteForAsync(owner, starredLater));
        Assert.Contains(starredLater, await FavoritesScopeIdsAsync(owner));

        // 5-6. ...and un-stars the backfilled one: shown as not favorite, and out of the favorites list.
        await OldRevisionSetFavoriteAsync(unstarredLater, false);
        Assert.False(await IsFavoriteForAsync(owner, unstarredLater));
        Assert.DoesNotContain(unstarredLater, await FavoritesScopeIdsAsync(owner));

        // 7-8. The new revision's Owner toggle writes both places, and the previous revision (which
        // reads only the legacy column) sees the same state.
        var toggled = await OldRevisionInsertCollectionAsync(owner, "Toggled by new revision");
        await NewRevisionSetFavoriteAsync(owner, toggled, true);
        Assert.True(await LegacyIsFavoriteAsync(toggled));
        Assert.True(await HasFavoriteRowAsync(owner, toggled));
        await NewRevisionSetFavoriteAsync(owner, toggled, false);
        Assert.False(await LegacyIsFavoriteAsync(toggled));
        Assert.False(await HasFavoriteRowAsync(owner, toggled));

        // 9. A Contributor's mark lives only in CollectionFavorites and is independent of the Owner's.
        await ExecuteAsync(
            $"INSERT INTO [collections].[CollectionCollaborators] ([CollectionId], [UserId], [Role], [CreatedAtUtc], [CreatedByUserId]) VALUES ({starredLater}, {contributor}, 'Contributor', SYSUTCDATETIME(), {owner})");
        await NewRevisionSetFavoriteAsync(contributor, starredLater, false);
        Assert.False(await IsFavoriteForAsync(contributor, starredLater));
        Assert.True(await IsFavoriteForAsync(owner, starredLater));
        await NewRevisionSetFavoriteAsync(owner, starredLater, false);
        await NewRevisionSetFavoriteAsync(contributor, starredLater, true);
        Assert.False(await IsFavoriteForAsync(owner, starredLater));
        Assert.False(await LegacyIsFavoriteAsync(starredLater)); // the Contributor never touches the Owner's column
        Assert.True(await IsFavoriteForAsync(contributor, starredLater));
        await NewRevisionSetFavoriteAsync(owner, starredLater, true);

        // 10-11. The previous revision is gone; the contract rebuilds the Owners' rows from the
        // legacy column (the stale backfilled row of the un-starred Collection goes, the
        // legacy-only star gets its row) and leaves the Contributor's row alone.
        await ExecuteAsync("ALTER TABLE [collections].[Collections] DROP COLUMN [IconImageBlobName]");
        await ExecuteAsync("DROP TABLE [collections].[CollectionSharePasswords]");
        await ExecuteAsync("DROP TABLE [collections].[CollectionLinkSubmissions]");
        await ExecuteAsync("ALTER TABLE [notifications].[Notifications] DROP COLUMN [CollectionId]");
        await MigrateToAsync(null);
        Assert.False(await HasFavoriteRowAsync(owner, unstarredLater));
        Assert.True(await HasFavoriteRowAsync(owner, starredLater));
        Assert.True(await HasFavoriteRowAsync(contributor, starredLater));
        Assert.Equal(0, await ScalarAsync<int>(
            $"""
            SELECT COUNT(*) AS [Value]
            FROM [collections].[Collections] AS c
            WHERE c.[UserId] = {owner}
                AND c.[IsFavorite] <> CASE WHEN EXISTS (
                    SELECT 1 FROM [collections].[CollectionFavorites] AS f
                    WHERE f.[UserId] = c.[UserId] AND f.[CollectionId] = c.[Id]) THEN 1 ELSE 0 END
            """));

        // 12. No bridge object was ever created (and so none is left behind).
        Assert.Equal(0, await ScalarAsync<int>("SELECT COUNT(*) AS [Value] FROM sys.triggers"));

        // 13. Every effective state is exactly what the users last chose.
        Assert.True(await IsFavoriteForAsync(owner, starredLater));
        Assert.False(await IsFavoriteForAsync(owner, unstarredLater));
        Assert.False(await IsFavoriteForAsync(owner, toggled));
        Assert.True(await IsFavoriteForAsync(contributor, starredLater));

        // Down: the contract changes no schema; the expand drops only what it added, and the
        // Owners' marks survive in the legacy column.
        await MigrateToAsync(Contract);
        Assert.True(await LegacyIsFavoriteAsync(starredLater));
        Assert.False(await LegacyIsFavoriteAsync(unstarredLater));
    }

    // The previous revision's favorite write, the way EF issues it (rowversion OUTPUT included -
    // this is also what a trigger on Collections would have broken).
    private Task OldRevisionSetFavoriteAsync(long collectionId, bool isFavorite) =>
        ScalarAsync<byte[]>(
            $"UPDATE [collections].[Collections] SET [IsFavorite] = {(isFavorite ? 1 : 0)}, [UpdatedAtUtc] = SYSUTCDATETIME() OUTPUT INSERTED.[RowVersion] AS [Value] WHERE [Id] = {collectionId}");

    private async Task NewRevisionSetFavoriteAsync(long userId, long collectionId, bool isFavorite)
    {
        await using var db = NewContext();
        await new CollectionStore(db).SetFavoriteAsync(userId, collectionId, isFavorite, DateTimeOffset.UtcNow);
    }

    private async Task<bool> IsFavoriteForAsync(long userId, long collectionId)
    {
        await using var db = NewContext();
        return (await new CollectionStore(db).GetAsync(userId, collectionId)).IsFavorite;
    }

    private async Task<IReadOnlyList<long>> FavoritesScopeIdsAsync(long userId)
    {
        await using var db = NewContext();
        var page = await new CollectionStore(db).ListByScopeAsync(
            userId, Juple.Application.Collections.ListCollections.CollectionListScope.Favorites, null, null, null, 50);
        return page.Items.Select(collection => collection.Id).ToList();
    }

    private async Task<bool> LegacyIsFavoriteAsync(long collectionId) =>
        await ScalarAsync<int>($"SELECT CAST([IsFavorite] AS int) AS [Value] FROM [collections].[Collections] WHERE [Id] = {collectionId}") == 1;

    private async Task<bool> HasFavoriteRowAsync(long userId, long collectionId) =>
        await ScalarAsync<int>(
            $"SELECT COUNT(*) AS [Value] FROM [collections].[CollectionFavorites] WHERE [UserId] = {userId} AND [CollectionId] = {collectionId}") == 1;

    // After the collaboration contract every writer supplies a Juple ID.
    private Task<long> CurrentRevisionInsertUserAsync() =>
        ScalarAsync<long>(
            $"""
            INSERT INTO [users].[Users] ([CreatedAtUtc], [DefaultCurrencyCode], [PreferredLocale], [TimeZoneId], [UpdatedAtUtc], [PublicCode])
            OUTPUT INSERTED.[Id] AS [Value]
            VALUES (SYSUTCDATETIME(), NULL, 'en-US', 'UTC', SYSUTCDATETIME(), '{Juple.Domain.Users.UserPublicCode.Generate()}');
            """);

    private JupleDbContext NewContext() =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task MigrateToAsync(string? targetMigration)
    {
        await using var db = NewContext();
        await db.GetService<IMigrator>().MigrateAsync(targetMigration);
    }

    private async Task<T> ScalarAsync<T>(string sql)
    {
        await using var db = NewContext();
#pragma warning disable EF1002 // Test-only SQL built from ids this test generated itself.
        return (await db.Database.SqlQueryRaw<T>(sql).ToListAsync()).Single();
#pragma warning restore EF1002
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var db = NewContext();
#pragma warning disable EF1002 // Test-only SQL built from ids this test generated itself.
        await db.Database.ExecuteSqlRawAsync(sql);
#pragma warning restore EF1002
    }

    private Task<bool> IsNullableAsync(string schema, string table, string column) =>
        ScalarAsync<bool>(
            $"SELECT CAST([is_nullable] AS bit) AS [Value] FROM sys.columns WHERE [object_id] = OBJECT_ID('[{schema}].[{table}]') AND [name] = '{column}'");

    private async Task<bool> RollingDeployDefaultExistsAsync() =>
        await ScalarAsync<int>(
            "SELECT COUNT(*) AS [Value] FROM sys.default_constraints WHERE [name] IN ('DF_Users_PublicCode_RollingDeploy', 'DF_CollectionItems_AddedByUserId_RollingDeploy')") == 2;

    private static bool IsJupleId(string? value) =>
        value is { Length: 8 } && value.All(JupleIdAlphabet.Contains);

    // The previous API revision's INSERTs: only the columns it knows about.
    private Task<long> OldRevisionInsertUserAsync() =>
        ScalarAsync<long>(
            """
            INSERT INTO [users].[Users] ([CreatedAtUtc], [DefaultCurrencyCode], [PreferredLocale], [TimeZoneId], [UpdatedAtUtc])
            OUTPUT INSERTED.[Id] AS [Value]
            VALUES (SYSUTCDATETIME(), NULL, 'en-US', 'UTC', SYSUTCDATETIME());
            """);

    private Task<long> OldRevisionInsertCollectionAsync(long ownerId, string name) =>
        ScalarAsync<long>(
            $"""
            INSERT INTO [collections].[Collections] ([UserId], [Name], [NameNormalized], [CreatedAtUtc], [UpdatedAtUtc])
            OUTPUT INSERTED.[Id] AS [Value]
            VALUES ({ownerId}, N'{name}', N'{name.ToUpperInvariant()}', SYSUTCDATETIME(), SYSUTCDATETIME());
            """);

    private Task<long> OldRevisionInsertItemAsync(long ownerId, string url) =>
        ScalarAsync<long>(
            $"""
            INSERT INTO [items].[Items] ([UserId], [Url], [SavedAtUtc])
            OUTPUT INSERTED.[Id] AS [Value]
            VALUES ({ownerId}, N'{url}', SYSUTCDATETIME());
            """);

    private Task<long> OldRevisionInsertCollectionItemAsync(long collectionId, long itemId, int sortOrder) =>
        ScalarAsync<long>(
            $"""
            INSERT INTO [collections].[CollectionItems] ([CollectionId], [ItemId], [AddedAtUtc], [SortOrder])
            OUTPUT INSERTED.[Id] AS [Value]
            VALUES ({collectionId}, {itemId}, SYSUTCDATETIME(), {sortOrder});
            """);
}
