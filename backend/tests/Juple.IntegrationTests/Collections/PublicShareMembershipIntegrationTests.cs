using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.IntegrationTests.Collections;

/// <summary>"Is this signed-in user already in the Collection behind a public link?" - the lookup that sends a member to the normal Collection screen.</summary>
public sealed class PublicShareMembershipIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _stranger;
    private long _collectionId;
    private string _publicId = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set to run these integration tests.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _stranger = await NewUserAsync();
        _collectionId = (await new CollectionStore(_db).CreateAsync(_owner, "Shared", "SHARED", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        _publicId = Guid.NewGuid().ToString("N");
        await new CollectionShareStore(_db).EnableAsync(_owner, _collectionId, _publicId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM collections.CollectionShares WHERE CollectionId = {_collectionId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM collections.CollectionCollaborators WHERE CollectionId = {_collectionId}");
        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM collections.Collections WHERE Id = {_collectionId}");
        foreach (var id in _userIds)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM users.Users WHERE Id = {id}");
        }

        await _db.DisposeAsync();
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private PublicShareMembershipStore Store() => new(_db);

    [Fact]
    public async Task TheOwner_IsAMember_WithTheCollectionId()
    {
        var result = await Store().GetAsync(_publicId, _owner);

        Assert.Equal(new(true, _collectionId, "owner"), result);
    }

    [Theory]
    [InlineData(CollectionCollaboratorRole.Contributor, "contributor")]
    [InlineData(CollectionCollaboratorRole.Viewer, "viewer")]
    [InlineData(CollectionCollaboratorRole.Submitter, "submitter")]
    public async Task AnAcceptedMember_IsAMember_WithTheirRealRole(CollectionCollaboratorRole role, string wire)
    {
        var member = await NewUserAsync();
        _db.CollectionCollaborators.Add(new CollectionCollaborator(_collectionId, member, role, _owner, DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        Assert.Equal(new(true, _collectionId, wire), await Store().GetAsync(_publicId, member));
    }

    [Fact]
    public async Task ANonMember_LearnsNothingButThatTheyAreNotAMember()
    {
        var result = await Store().GetAsync(_publicId, _stranger);

        Assert.Equal(new(false, null, null, true, false), result);
    }

    [Fact]
    public async Task AnUnknownRevokedOrDeletedShare_IsUnavailable_EvenForTheOwner()
    {
        Assert.Null(await Store().GetAsync("does-not-exist-" + Guid.NewGuid().ToString("N"), _owner));

        await _db.Database.ExecuteSqlInterpolatedAsync($"UPDATE collections.CollectionShares SET IsActive = 0 WHERE CollectionId = {_collectionId}");
        Assert.Null(await Store().GetAsync(_publicId, _owner));
    }
}
