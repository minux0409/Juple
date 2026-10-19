using Juple.Domain.Admin;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Admin;

/// <summary>
/// The first-owner operator procedure (infra/sql/admin/grant-first-owner.sql) and the emergency stop (deactivate-admin.sql), run
/// exactly as written against a freshly migrated, empty database - the grant table must be empty for the first-owner procedure.
/// </summary>
public sealed class AdminBootstrapScriptTests : IAsyncLifetime
{
    private string _connectionString = null!;

    public async Task InitializeAsync()
    {
        var baseConnectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        var builder = new SqlConnectionStringBuilder(baseConnectionString);
        builder.InitialCatalog = $"{builder.InitialCatalog}_AdminBootstrap_{Guid.NewGuid():N}";
        _connectionString = builder.ConnectionString;
        await using var db = NewContext();
        await db.Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        await using var db = NewContext();
        await db.Database.EnsureDeletedAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    [Fact]
    public async Task TheFirstOwnerIsGrantedOnlyByJupleId_OnlyOnce_AndCanBeStopped()
    {
        await using var db = NewContext();
        var owner = new User("ko-KR", "Asia/Seoul", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        var other = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        db.Users.AddRange(owner, other);
        await db.SaveChangesAsync();

        var unknown = await Assert.ThrowsAsync<SqlException>(() => RunAsync("grant-first-owner.sql", "ZZZZ2222"));
        Assert.Equal(51001, unknown.Number);
        Assert.False(await NewContext().AdminUsers.AnyAsync());

        // The displayed form ("@K7MP-4Q8N", any case) is accepted.
        await RunAsync("grant-first-owner.sql", "@" + owner.PublicCode[..4].ToLowerInvariant() + "-" + owner.PublicCode[4..]);
        var grant = await NewContext().AdminUsers.AsNoTracking().SingleAsync();
        Assert.Equal((owner.Id, AdminRole.Owner, true, (long?)null), (grant.UserId, grant.Role, grant.IsActive, grant.GrantedByUserId));

        await RunAsync("grant-first-owner.sql", owner.PublicCode); // the same person again: nothing changes
        Assert.Equal(1, await NewContext().AdminUsers.CountAsync());

        var second = await Assert.ThrowsAsync<SqlException>(() => RunAsync("grant-first-owner.sql", other.PublicCode));
        Assert.Equal(51002, second.Number);
        Assert.Equal(1, await NewContext().AdminUsers.CountAsync());

        await RunAsync("deactivate-admin.sql", owner.PublicCode);
        Assert.False((await NewContext().AdminUsers.AsNoTracking().SingleAsync()).IsActive);
    }

    private async Task RunAsync(string script, string jupleId)
    {
        var text = await File.ReadAllTextAsync(ScriptPath(script));
        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        // Exactly what sqlcmd does with -v JupleId=...: a textual substitution of the variable.
        command.CommandText = text.Replace("$(JupleId)", jupleId.Replace("'", "''", StringComparison.Ordinal), StringComparison.Ordinal);
        await command.ExecuteNonQueryAsync();
    }

    private static string ScriptPath(string name)
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            var candidate = Path.Combine(directory.FullName, "infra", "sql", "admin", name);
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        throw new FileNotFoundException($"infra/sql/admin/{name} was not found above {AppContext.BaseDirectory}.");
    }
}
