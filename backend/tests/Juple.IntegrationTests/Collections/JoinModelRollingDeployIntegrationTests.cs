using Juple.Application.Collections.EnableCollectionShare;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// The join-model correction replayed as a rolling deployment: EXPAND (AddCollectionShareIsPublic, additive; JoinMode kept) ->
/// deploy the new runtimes -> CONTRACT (DropCollectionShareJoinMode). Three combinations are proven:
///   1. INTERMEDIATE (JoinMode) model against the EXPANDED database - the revision still running on DEV keeps working.
///   2. CURRENT model against the EXPANDED database - IsPublic is mapped, the unused legacy JoinMode column is harmless.
///   3. CURRENT model against the CONTRACTED database - works once JoinMode is finally dropped.
/// The fourth combination, INTERMEDIATE model against the CONTRACTED database, is deliberately NOT supported (it would fail on every
/// CollectionShares query): the contract migration is forbidden until no old runtime (API revision, notification worker revision,
/// push-dispatch Job template) can run any more. Each test uses its own throwaway database.
/// </summary>
public sealed class JoinModelRollingDeployIntegrationTests : IAsyncLifetime
{
    private const string Intermediate = "20261009080751_AddCollectionJoinRequestsAndShareJoinMode";
    private const string Expand = "20261009104029_AddCollectionShareIsPublic";
    private const string Contract = "20261009104055_DropCollectionShareJoinMode";

    private string _connectionString = null!;

    public Task InitializeAsync()
    {
        var baseConnectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder(baseConnectionString);
        builder.InitialCatalog = $"{builder.InitialCatalog}_JoinModel_{Guid.NewGuid():N}";
        _connectionString = builder.ConnectionString;
        return Task.CompletedTask;
    }

    public async Task DisposeAsync()
    {
        await using var db = NewContext();
        await db.Database.EnsureDeletedAsync();
    }

    [Fact]
    public async Task IntermediateModel_KeepsWorking_OnTheExpandedDatabase_AndOldPendingRequestsBecomeObsoleteOnce()
    {
        await MigrateToAsync(Intermediate);
        var (owner, collection) = await SeedAsync();
        var requester = await InsertUserAsync();
        // What the intermediate revision wrote: a share with its JoinMode, and a waiting request.
        await ExecuteAsync($"INSERT INTO [collections].[CollectionShares] ([CollectionId],[PublicId],[IsActive],[CreatedAtUtc],[UpdatedAtUtc],[Permission],[JoinMode]) VALUES ({collection},'oldpub1',1,SYSUTCDATETIME(),SYSUTCDATETIME(),'Read','RequestApproval')");
        await ExecuteAsync($"INSERT INTO [collections].[CollectionJoinRequests] ([CollectionId],[RequesterUserId],[Status],[CreatedAtUtc]) VALUES ({collection},{requester},'Pending',SYSUTCDATETIME())");
        await ExecuteAsync($"INSERT INTO [collections].[CollectionJoinRequests] ([CollectionId],[RequesterUserId],[Status],[CreatedAtUtc],[ResolvedAtUtc]) VALUES ({collection},{owner},'Approved',SYSUTCDATETIME(),SYSUTCDATETIME())");

        await MigrateToAsync(Expand);

        // The one-time transition: the Pending request is Obsolete, an already decided one is untouched.
        Assert.Equal("Obsolete", await ScalarAsync<string>($"SELECT [Status] AS [Value] FROM [collections].[CollectionJoinRequests] WHERE [RequesterUserId] = {requester}"));
        Assert.Equal("Approved", await ScalarAsync<string>($"SELECT [Status] AS [Value] FROM [collections].[CollectionJoinRequests] WHERE [RequesterUserId] = {owner}"));
        // The intermediate revision's own statements - which know JoinMode and not IsPublic - still run.
        Assert.Equal("RequestApproval", await ScalarAsync<string>("SELECT [JoinMode] AS [Value] FROM [collections].[CollectionShares] WHERE [PublicId] = 'oldpub1'"));
        await ExecuteAsync("UPDATE [collections].[CollectionShares] SET [JoinMode] = 'SelfJoin', [UpdatedAtUtc] = SYSUTCDATETIME() WHERE [PublicId] = 'oldpub1'");
        await ExecuteAsync($"INSERT INTO [collections].[CollectionShares] ([CollectionId],[PublicId],[IsActive],[CreatedAtUtc],[UpdatedAtUtc],[Permission],[JoinMode]) VALUES ({await InsertCollectionAsync(owner, "Second")},'oldpub2',1,SYSUTCDATETIME(),SYSUTCDATETIME(),'Read','None')");
        // Rows from either revision are public until the Owner says otherwise.
        Assert.Equal(2, await ScalarAsync<int>("SELECT COUNT(*) AS [Value] FROM [collections].[CollectionShares] WHERE [IsPublic] = 1"));
    }

    [Fact]
    public async Task CurrentModel_Works_OnTheExpandedDatabase_WithTheUnusedJoinModeColumnStillThere()
    {
        await MigrateToAsync(Expand);
        Assert.True(await JoinModeColumnExistsAsync());
        var (owner, collection) = await SeedAsync();

        await using (var db = NewContext())
        {
            var service = new EnableCollectionShareService(new CollectionShareStore(db), TimeProvider.System);
            var privateShare = await service.MakePrivateAsync(owner, collection);
            Assert.False(privateShare.IsPublic);
            db.ChangeTracker.Clear();
            var publicShare = await service.EnableAsync(owner, collection);
            Assert.True(publicShare.IsPublic);
            Assert.Equal(privateShare.PublicId, publicShare.PublicId);
        }

        // The legacy column was never written by the new model: it holds its default.
        Assert.Equal("None", await ScalarAsync<string>($"SELECT [JoinMode] AS [Value] FROM [collections].[CollectionShares] WHERE [CollectionId] = {collection}"));
    }

    [Fact]
    public async Task CurrentModel_Works_OnTheContractedDatabase_AfterJoinModeIsDropped()
    {
        await MigrateToAsync(Expand);
        var (owner, collection) = await SeedAsync();
        await MigrateToAsync(Contract);

        Assert.False(await JoinModeColumnExistsAsync());
        Assert.Equal(0, await ScalarAsync<int>("SELECT COUNT(*) AS [Value] FROM sys.default_constraints dc JOIN sys.columns c ON c.object_id = dc.parent_object_id AND c.column_id = dc.parent_column_id WHERE c.name = 'JoinMode'"));
        await using var db = NewContext();
        var service = new EnableCollectionShareService(new CollectionShareStore(db), TimeProvider.System);
        var share = await service.MakePrivateAsync(owner, collection);
        Assert.False(share.IsPublic);
        db.ChangeTracker.Clear();
        Assert.True((await service.EnableAsync(owner, collection)).IsPublic);
    }

    [Fact]
    public async Task TheContractIsReversible_ItsDownRestoresTheColumn()
    {
        await MigrateToAsync(Contract);
        await MigrateToAsync(Expand);
        Assert.True(await JoinModeColumnExistsAsync());
        await using var db = NewContext();
        Assert.Equal(Expand, (await db.Database.GetAppliedMigrationsAsync()).Last());
    }

    // ---------- helpers ----------

    private async Task<bool> JoinModeColumnExistsAsync() =>
        await ScalarAsync<int>("SELECT COUNT(*) AS [Value] FROM sys.columns WHERE object_id = OBJECT_ID('collections.CollectionShares') AND name = 'JoinMode'") == 1;

    private async Task<(long Owner, long Collection)> SeedAsync()
    {
        var owner = await InsertUserAsync();
        return (owner, await InsertCollectionAsync(owner, "Trip"));
    }

    private Task<long> InsertUserAsync() =>
        ScalarAsync<long>(
            $"""
            INSERT INTO [users].[Users] ([CreatedAtUtc], [DefaultCurrencyCode], [PreferredLocale], [TimeZoneId], [UpdatedAtUtc], [PublicCode])
            OUTPUT INSERTED.[Id] AS [Value]
            VALUES (SYSUTCDATETIME(), NULL, 'en-US', 'UTC', SYSUTCDATETIME(), '{Juple.Domain.Users.UserPublicCode.Generate()}');
            """);

    private Task<long> InsertCollectionAsync(long ownerId, string name) =>
        ScalarAsync<long>(
            $"""
            INSERT INTO [collections].[Collections] ([UserId], [Name], [NameNormalized], [CreatedAtUtc], [UpdatedAtUtc])
            OUTPUT INSERTED.[Id] AS [Value]
            VALUES ({ownerId}, N'{name}', N'{name.ToUpperInvariant()}', SYSUTCDATETIME(), SYSUTCDATETIME());
            """);

    private JupleDbContext NewContext() =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private async Task MigrateToAsync(string target)
    {
        await using var db = NewContext();
        await db.GetService<IMigrator>().MigrateAsync(target);
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
#pragma warning disable EF1002 // Test-only SQL.
        await db.Database.ExecuteSqlRawAsync(sql);
#pragma warning restore EF1002
    }
}
