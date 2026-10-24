using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.GetCollectionShare;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class CollectionLinkEnsurerTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 24, 1, 2, 3, TimeSpan.Zero);

    [Fact]
    public async Task Owner_WithoutAnyLink_GetsAPrivateLinkInsteadOfNull()
    {
        var store = new Store { Active = null };
        var service = new GetCollectionShareService(store, new CollectionLinkEnsurer(store, new FixedTime()));

        var share = await service.GetAsync(7, 41);

        Assert.NotNull(share);
        Assert.False(share!.IsPublic);
        Assert.Equal(41, store.EnsuredCollectionId);
        Assert.Equal(32, store.EnsuredPublicId!.Length);
    }

    [Fact]
    public async Task Owner_WithALink_IsNotTouched()
    {
        var store = new Store { Active = new CollectionShareDto(41, "abc", Now, Juple.Domain.Collections.CollectionSharePermission.Read, true) };
        var service = new GetCollectionShareService(store, new CollectionLinkEnsurer(store, new FixedTime()));

        var share = await service.GetAsync(7, 41);

        Assert.True(share!.IsPublic);
        Assert.Null(store.EnsuredCollectionId);
    }

    [Fact]
    public async Task Member_WithoutAnyLink_GetsThePrivateLinksPublicId()
    {
        var store = new Store { Active = null };
        var service = new GetCollectionShareLinkService(new AllowAccess(), new Reader(null), new CollectionLinkEnsurer(store, new FixedTime()));

        var publicId = await service.GetActivePublicIdAsync(9, 41);

        Assert.Equal(store.EnsuredPublicId, publicId);
        Assert.NotNull(publicId);
    }

    [Fact]
    public async Task Member_WhenTheLinkWasRevoked_GetsNothingAndNoLinkIsBroughtBack()
    {
        var store = new Store { Active = null, RevokedBefore = true };
        var service = new GetCollectionShareLinkService(new AllowAccess(), new Reader(null), new CollectionLinkEnsurer(store, new FixedTime()));

        Assert.Null(await service.GetActivePublicIdAsync(9, 41));
    }

    [Fact]
    public async Task Member_WithoutEnsurer_KeepsTheOldBehavior()
    {
        var service = new GetCollectionShareLinkService(new AllowAccess(), new Reader(null));

        Assert.Null(await service.GetActivePublicIdAsync(9, 41));
    }

    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class Reader(string? publicId) : ICollectionShareLinkReader
    {
        public Task<string?> GetActivePublicIdAsync(long collectionId, CancellationToken cancellationToken = default) => Task.FromResult(publicId);
    }

    private sealed class AllowAccess : ICollectionAccessService
    {
        public Task<CollectionAccess> RequireAsync(long userId, long collectionId, CollectionPermission permission, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CollectionAccess(collectionId, CollectionAccessRole.Contributor, false, 0));

        public Task<CollectionAccess> RequireUnlockedAsync(long userId, long collectionId, CollectionPermission permission, string? unlockToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionAccess> RequireContentAsync(long userId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class Store : ICollectionShareStore
    {
        public CollectionShareDto? Active { get; init; }
        public bool RevokedBefore { get; init; }
        public long? EnsuredCollectionId { get; private set; }
        public string? EnsuredPublicId { get; private set; }

        public Task<CollectionShareDto?> GetActiveAsync(long userId, long collectionId, CancellationToken cancellationToken = default) => Task.FromResult(Active);

        public Task<CollectionShareDto?> EnsureInitialPrivateLinkAsync(long collectionId, string candidatePublicId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            if (Active is not null || RevokedBefore)
            {
                return Task.FromResult(Active);
            }

            EnsuredCollectionId = collectionId;
            EnsuredPublicId = candidatePublicId;
            return Task.FromResult<CollectionShareDto?>(new CollectionShareDto(collectionId, candidatePublicId, nowUtc, Juple.Domain.Collections.CollectionSharePermission.Read, false));
        }

        public Task<CollectionShareDto> EnableAsync(long userId, long collectionId, string candidatePublicId, DateTimeOffset enabledAtUtc, Juple.Domain.Collections.CollectionSharePermission permission = Juple.Domain.Collections.CollectionSharePermission.Read, bool raiseLowerRoles = false, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task RevokeAsync(long userId, long collectionId, DateTimeOffset revokedAtUtc, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<CollectionShareDto> MakePrivateAsync(long userId, long collectionId, string candidatePublicId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<CollectionShareDto?> SetPermissionAsync(long userId, long collectionId, Juple.Domain.Collections.CollectionSharePermission permission, DateTimeOffset updatedAtUtc, bool raiseLowerRoles = false, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}
