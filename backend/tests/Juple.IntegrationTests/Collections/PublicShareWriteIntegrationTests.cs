using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Domain.Images;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// "모든 사용자: 작성" against a real SQL Server schema: a signed-in holder of a writable public link
/// adds their own link; it is attributed to them, published with public-safe fields only, and grants
/// nothing else. A read-only, revoked or locked link refuses.
/// </summary>
public sealed class PublicShareWriteIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _writer;
    private long _collectionId;
    private long _ownerItem;
    private long _writerItem;
    private long _writerOtherItem;

    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private EnableCollectionShareService _shareService = null!;
    private PublicCollectionService _public = null!;
    private PublicCollectionWriteService _publicWrite = null!;
    private GetCollectionItemsService _items = null!;
    private ItemStore _itemStore = null!;
    private CollectionUnlockTokenProtector _tokens = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _writer = await NewUserAsync();

        _collections = new CollectionStore(_db);
        _itemStore = new ItemStore(_db);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var lockStore = new CollectionLockStore(_db);
        var hasher = new CollectionLockPasswordHasher();
        var verifier = new CollectionPasswordVerifier(lockStore, hasher);
        var publicStore = new PublicCollectionStore(_db);
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _shareService = new EnableCollectionShareService(new CollectionShareStore(_db), TimeProvider.System);
        _public = new PublicCollectionService(publicStore, lockStore, verifier, _tokens, TimeProvider.System);
        _publicWrite = new PublicCollectionWriteService(publicStore, _collections, _tokens, TimeProvider.System);
        _items = new GetCollectionItemsService(_access, _collections, new FakeImageStorage());

        _collectionId = (await _collections.CreateAsync(_owner, "Open board", "OPEN BOARD", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _ownerItem = await NewItemAsync(_owner, "https://example.test/owner", memo: "owner memo");
        _writerItem = await NewItemAsync(_writer, "https://example.test/writer", memo: "writer private memo", withPhoto: true);
        _writerOtherItem = await NewItemAsync(_writer, "https://example.test/writer-2", memo: null);
        await new AddItemToCollectionService(_access, _collections, TimeProvider.System).AddAsync(_owner, _collectionId, _ownerItem);
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    [Fact]
    public async Task AReadLink_RefusesAdds_AndSwitchingItToWrite_LetsASignedInHolderAddTheirOwnLink()
    {
        var share = await _shareService.EnableAsync(_owner, _collectionId);
        Assert.Equal(CollectionSharePermission.Read, share.Permission);
        Assert.Equal("read", (await _public.GetCollectionAsync(share.PublicId))!.Permission);
        await Assert.ThrowsAsync<PublicShareReadOnlyException>(() => _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, null));

        Assert.Equal(CollectionSharePermission.Write, (await _shareService.SetPermissionAsync(_owner, _collectionId, CollectionSharePermission.Write))!.Permission);
        Assert.Equal("write", (await _public.GetCollectionAsync(share.PublicId))!.Permission);

        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Added, await _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, null));
        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Added, await _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, null)); // idempotent

        var membership = await _db.CollectionItems.AsNoTracking().SingleAsync(entry => entry.CollectionId == _collectionId && entry.ItemId == _writerItem);
        Assert.Equal(_writer, membership.AddedByUserId);
        Assert.True(membership.AddedViaPublicShare);
        // Adding grants no membership and no management.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _access.RequireAsync(_writer, _collectionId, CollectionPermission.View));
    }

    [Fact]
    public async Task APublicWritersLink_IsPublishedWithPublicSafeFieldsOnly_AndMembersNeverSeeTheirPrivateFields()
    {
        var share = await _shareService.EnableAsync(_owner, _collectionId, CollectionSharePermission.Write);
        await _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, null);

        var published = (await _public.GetItemsAsync(share.PublicId, null, 50))!.Items;
        Assert.Equal(["https://example.test/owner", "https://example.test/writer"], published.Select(item => item.Url).Order());
        var writerEntry = published.Single(item => item.Url == "https://example.test/writer");
        Assert.Equal("https://img.example.test/preview.jpg", writerEntry.PreviewImageUrl);
        // The public DTO has no memo, no uploaded image, no adder identity - by its very shape.
        Assert.Equal(["PreviewImageUrl", "Title", "Url"], typeof(PublicCollectionItemDto).GetProperties().Select(property => property.Name).Order());

        // In the app, the Owner sees it as someone else's link: no memo, no uploaded/cover image.
        var ownerView = (await _items.GetAsync(_owner, _collectionId, null, 50)).Items.Single(entry => entry.ItemId == _writerItem);
        Assert.False(ownerView.IsMine);
        Assert.Null(ownerView.Memo);
        Assert.Null(ownerView.CoverImage);
        Assert.Null(ownerView.RepresentativeImage);
    }

    [Fact]
    public async Task APublicWritersLink_ShowsTheOwnerOnly_ThatItCameThroughTheLink_NeverWho()
    {
        var share = await _shareService.EnableAsync(_owner, _collectionId, CollectionSharePermission.Write);
        await _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, null);

        var ownerView = (await _items.GetAsync(_owner, _collectionId, null, 50)).Items;
        // Never who: no identity, no photo, not even a "not the owner" flag beyond the kind.
        Assert.Equal(new CollectionItemAdderDto(CollectionItemAdderKinds.PublicLink), ownerView.Single(item => item.ItemId == _writerItem).AddedBy);
        var ownLink = ownerView.Single(item => item.ItemId == _ownerItem).AddedBy!;
        Assert.Equal(CollectionItemAdderKinds.Me, ownLink.Kind);
        Assert.True(ownLink.IsCollectionOwner);
    }

    [Fact]
    public async Task OnlyTheCallersOwnLiveItem_CanBeAdded()
    {
        var share = await _shareService.EnableAsync(_owner, _collectionId, CollectionSharePermission.Write);

        await Assert.ThrowsAsync<ItemNotFoundException>(() => _publicWrite.AddItemAsync(_writer, share.PublicId, _ownerItem, null));
        var foreign = await NewItemAsync(_owner, "https://example.test/owner-2", memo: null);
        await Assert.ThrowsAsync<ItemNotFoundException>(() => _publicWrite.AddItemAsync(_writer, share.PublicId, foreign, null));
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _collectionId && entry.ItemId == foreign));
    }

    [Fact]
    public async Task ARevokedLink_AcceptsNothing_AndTheOwnerCanRemoveAPublicWritersLink()
    {
        var share = await _shareService.EnableAsync(_owner, _collectionId, CollectionSharePermission.Write);
        await _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, null);

        await new RemoveItemFromCollectionService(_access, _collections).RemoveAsync(_owner, _collectionId, _writerItem);
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _collectionId && entry.ItemId == _writerItem));
        // The writer's Item itself stays theirs.
        Assert.True(await _db.Items.AnyAsync(item => item.Id == _writerItem && item.UserId == _writer && item.DeletedAtUtc == null));

        await new CollectionShareStore(_db).RevokeAsync(_owner, _collectionId, DateTimeOffset.UtcNow);
        Assert.Null(await _publicWrite.AddItemAsync(_writer, share.PublicId, _writerOtherItem, null));
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _collectionId && entry.ItemId == _writerOtherItem));
    }

    [Fact]
    public async Task ALockedCollection_NeedsTheLinksUnlockGrant_BeforeAnyAdd()
    {
        var share = await _shareService.EnableAsync(_owner, _collectionId, CollectionSharePermission.Write);
        var lockService = new CollectionLockService(
            _access, new CollectionLockStore(_db), new CollectionLockSettingsStore(_db),
            new CollectionPasswordVerifier(new CollectionLockStore(_db), new CollectionLockPasswordHasher()), _tokens, TimeProvider.System);
        await new CollectionLockPasswordService(new CollectionLockSettingsStore(_db), new CollectionLockPasswordHasher(), TimeProvider.System)
            .ResetAsync(_owner, "board-pass", "board-pass", DateTimeOffset.UtcNow);
        await lockService.LockAsync(_owner, _collectionId);
        // Locked before share passwords existed (legacy mode): the link still opens with the lock password.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionSharePasswords (CollectionId, Mode, PasswordVersion, CreatedAtUtc, UpdatedAtUtc) VALUES ({_collectionId}, 'LegacyCommonLock', 1, {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})");
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionLockedException>(() => _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, null));
        var grant = await _public.UnlockAsync(share.PublicId, "board-pass");
        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Added, await _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, grant!.Token));
    }

    [Fact]
    public async Task AccountDeletionOfAPublicWriter_RemovesExactlyTheirLinks()
    {
        var share = await _shareService.EnableAsync(_owner, _collectionId, CollectionSharePermission.Write);
        await _publicWrite.AddItemAsync(_writer, share.PublicId, _writerItem, null);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_writer, $"test/{_writer}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_writer);

        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _collectionId && entry.AddedByUserId == _writer));
        Assert.Single((await _public.GetItemsAsync(share.PublicId, null, 50))!.Items);
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewItemAsync(long userId, string url, string? memo, bool withPhoto = false)
    {
        var saved = await _itemStore.SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        var item = await _db.Items.SingleAsync(entry => entry.Id == saved.Entry.Id);
        item.UpdateDetails("Title of " + url, memo);
        item.SetPreviewImageUrl("https://img.example.test/preview.jpg");
        if (withPhoto)
        {
            var image = new ItemImage(item.Id, $"users/{userId}/items/{item.Id}/photo.jpg", "image/jpeg", 10, 0, DateTimeOffset.UtcNow);
            _db.ItemImages.Add(image);
            await _db.SaveChangesAsync();
            item.SetCoverImageId(image.Id);
        }

        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        return item.Id;
    }

    private sealed class FakeImageStorage : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"users/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(new Uri($"https://blob.example.test/{blobName}"));
    }
}
