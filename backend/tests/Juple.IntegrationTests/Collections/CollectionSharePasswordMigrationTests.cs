using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// AddCollectionSharePasswords against data that existed before it: a Collection that was locked AND
/// already had recipients (an accepted member, an active public link or a still-acceptable invitation)
/// - so protected them with the Owner's lock password - keeps that protection as the legacy mode.
/// Every other Collection, locked or not, gets no row (share-password mode None). No Collection, lock,
/// membership, invitation or link data is touched. Runs on a database of its own (created and dropped
/// here), stepped from the previous migration.
/// </summary>
public sealed class CollectionSharePasswordMigrationTests : IAsyncLifetime
{
    private const string PreviousMigration = "20260928070559_AddCollectionIconImage";
    private const string ThisMigration = "20260929045050_AddCollectionSharePasswords";

    private JupleDbContext _db = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        var builder = new SqlConnectionStringBuilder(connectionString)
        {
            // A database of its own next to the test database (never the test database itself).
            InitialCatalog = $"JupleSharePasswordMigration_{Guid.NewGuid():N}",
        };
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(builder.ConnectionString).Options);
        await _db.GetService<IMigrator>().MigrateAsync(PreviousMigration);
    }

    public async Task DisposeAsync()
    {
        await _db.Database.EnsureDeletedAsync();
        await _db.DisposeAsync();
    }

    [Fact]
    public async Task OnlyLockedCollectionsWithRecipients_BecomeLegacy_AndNothingElseChanges()
    {
        var owner = await NewUserAsync();
        var member = await NewUserAsync();
        var invitee = await NewUserAsync();
        var now = DateTimeOffset.UtcNow;

        var lockedAlone = await NewCollectionAsync(owner, "LockedAlone", locked: true);
        var lockedMember = await NewCollectionAsync(owner, "LockedMember", locked: true);
        var lockedLink = await NewCollectionAsync(owner, "LockedLink", locked: true);
        var lockedInvited = await NewCollectionAsync(owner, "LockedInvited", locked: true);
        var lockedExpiredInvite = await NewCollectionAsync(owner, "LockedExpiredInvite", locked: true);
        var lockedEndedSharing = await NewCollectionAsync(owner, "LockedEndedSharing", locked: true);
        var lockedDeletedMember = await NewCollectionAsync(owner, "LockedDeletedMember", locked: true, deleted: true);
        var lockedDeletedAlone = await NewCollectionAsync(owner, "LockedDeletedAlone", locked: true, deleted: true);
        var openMember = await NewCollectionAsync(owner, "OpenMember", locked: false);

        foreach (var collectionId in new[] { lockedMember, lockedDeletedMember, openMember })
        {
            _db.CollectionCollaborators.Add(new CollectionCollaborator(collectionId, member, CollectionCollaboratorRole.Viewer, owner, now));
        }

        await _db.SaveChangesAsync();
        // Raw SQL, on purpose: the database is at the PREVIOUS migration, so the current model's later columns (IsPublic) do not exist yet.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionShares (CollectionId, PublicId, IsActive, CreatedAtUtc, UpdatedAtUtc, RevokedAtUtc) VALUES ({lockedLink}, {Guid.NewGuid().ToString("N")}, 1, {now}, {now}, NULL)");
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionShares (CollectionId, PublicId, IsActive, CreatedAtUtc, UpdatedAtUtc, RevokedAtUtc) VALUES ({lockedEndedSharing}, {Guid.NewGuid().ToString("N")}, 0, {now}, {now}, {now})");
        _db.CollectionInvitations.Add(new CollectionInvitation(lockedInvited, invitee, owner, CollectionCollaboratorRole.Viewer, now));
        _db.CollectionInvitations.Add(new CollectionInvitation(lockedExpiredInvite, invitee, owner, CollectionCollaboratorRole.Viewer, now));
        var declined = new CollectionInvitation(lockedEndedSharing, invitee, owner, CollectionCollaboratorRole.Viewer, now);
        declined.Decline(now);
        _db.CollectionInvitations.Add(declined);
        await _db.SaveChangesAsync();
        // Still Pending, but past its lifetime - it can no longer be accepted (CollectionInvitation.IsPendingAt).
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE collections.CollectionInvitations SET CreatedAtUtc = {now.AddDays(-20)}, ExpiresAtUtc = {now.AddDays(-6)} WHERE CollectionId = {lockedExpiredInvite}");
        _db.ChangeTracker.Clear();
        var before = await SnapshotAsync();

        await _db.GetService<IMigrator>().MigrateAsync(ThisMigration);
        _db.ChangeTracker.Clear();

        var rows = await _db.CollectionSharePasswords.AsNoTracking().OrderBy(row => row.CollectionId).ToListAsync();
        Assert.Equal([lockedMember, lockedLink, lockedInvited, lockedDeletedMember], rows.Select(row => row.CollectionId));
        Assert.All(rows, row =>
        {
            Assert.Equal(CollectionSharePasswordMode.LegacyCommonLock, row.Mode);
            Assert.Null(row.PasswordHash);
            Assert.Null(row.EncryptedPassword);
            Assert.Equal(1, row.PasswordVersion);
            Assert.Equal(TimeSpan.Zero, row.CreatedAtUtc.Offset);
        });
        // No row is mode None: only the Owner's own lock applies to these, as it always did.
        foreach (var none in new[] { lockedAlone, lockedExpiredInvite, lockedEndedSharing, lockedDeletedAlone, openMember })
        {
            Assert.DoesNotContain(rows, row => row.CollectionId == none);
        }

        Assert.Equal(before, await SnapshotAsync());
    }

    /// <summary>
    /// Raw SQL with only the columns the previous migration's Users table has - the current EF
    /// model may carry Users columns added by later migrations (e.g. ProfileImageBlobName), which
    /// this older schema does not have yet.
    /// </summary>
    private async Task<long> NewUserAsync()
    {
#pragma warning disable EF1002 // Test-only SQL; the only interpolated value is a freshly generated Juple ID.
        return (await _db.Database.SqlQueryRaw<long>(
            $"""
            INSERT INTO [users].[Users] ([CreatedAtUtc], [DefaultCurrencyCode], [PreferredLocale], [TimeZoneId], [UpdatedAtUtc], [PublicCode])
            OUTPUT INSERTED.[Id] AS [Value]
            VALUES (SYSUTCDATETIME(), NULL, 'ko-KR', 'Asia/Seoul', SYSUTCDATETIME(), '{UserPublicCode.Generate()}');
            """).ToListAsync()).Single();
#pragma warning restore EF1002
    }

    private async Task<long> NewCollectionAsync(long ownerId, string name, bool locked, bool deleted = false)
    {
        var id = (await new CollectionStore(_db).CreateAsync(ownerId, name, name.ToUpperInvariant(), CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        if (locked)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"UPDATE collections.Collections SET IsLocked = 1, LockVersion = 4 WHERE Id = {id}");
        }

        if (deleted)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"UPDATE collections.Collections SET DeletedAtUtc = {DateTimeOffset.UtcNow} WHERE Id = {id}");
        }

        return id;
    }

    /// <summary>
    /// Every Collection's lock and lifecycle columns, and every membership, invitation and link, as
    /// text - must be identical before and after.
    /// </summary>
    private async Task<string> SnapshotAsync() =>
        string.Join(
            "|",
            (await _db.Collections.AsNoTracking()
                .OrderBy(collection => collection.Id)
                .Select(collection => $"{collection.Id}:{collection.Name}:{collection.IsLocked}:{collection.LockVersion}:{collection.LockPasswordHash}:{collection.DeletedAtUtc}")
                .ToListAsync())
            .Concat(await _db.CollectionCollaborators.AsNoTracking()
                .OrderBy(collaborator => collaborator.Id)
                .Select(collaborator => $"m{collaborator.Id}:{collaborator.CollectionId}:{collaborator.UserId}:{collaborator.Role}")
                .ToListAsync())
            .Concat(await _db.CollectionInvitations.AsNoTracking()
                .OrderBy(invitation => invitation.Id)
                .Select(invitation => $"i{invitation.Id}:{invitation.CollectionId}:{invitation.InvitedUserId}:{invitation.Status}:{invitation.ExpiresAtUtc}")
                .ToListAsync())
            .Concat(await _db.CollectionShares.AsNoTracking()
                .OrderBy(share => share.Id)
                .Select(share => $"s{share.Id}:{share.CollectionId}:{share.PublicId}:{share.IsActive}:{share.Permission}")
                .ToListAsync()));
}
