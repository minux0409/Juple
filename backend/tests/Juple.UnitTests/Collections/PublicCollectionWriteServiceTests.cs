using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Controllers;
using Juple.Application.Collections;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
using Juple.Domain.Collections;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.UnitTests.Collections;

public sealed class PublicCollectionWriteServiceTests
{
    private const string PublicId = "abc";
    private const long Writer = 7;
    private const long CollectionId = 10;
    private const long ShareId = 3;
    private static readonly DateTimeOffset Now = new(2026, 9, 27, 0, 0, 0, TimeSpan.Zero);

    private readonly StubShareStore _shares = new();
    private readonly RecordingWriteStore _writes = new();

    private PublicCollectionWriteService Service() =>
        new(_shares, _writes, new FakeUnlockTokenProtector(), new MutableTimeProvider(Now));

    [Fact]
    public async Task AWritableLink_AddsTheCallersOwnItem()
    {
        _shares.State = new PublicShareState(ShareId, CollectionId, "Trip", false, 0, CollectionSharePermission.Write);

        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Added, await Service().AddItemAsync(Writer, PublicId, 55, null));
        Assert.Equal((PublicId, Writer, 55L), _writes.Last);
    }

    [Fact]
    public async Task AnAddThroughTheLink_TellsTheCollectionsMembers_ARefusedOneDoesNot()
    {
        var publisher = new CollectionLockScopeTests.RecordingSocialPublisher();
        _shares.State = new PublicShareState(ShareId, CollectionId, "Trip", false, 0, CollectionSharePermission.Read);
        await Assert.ThrowsAsync<PublicShareReadOnlyException>(() =>
            new PublicCollectionWriteService(_shares, _writes, new FakeUnlockTokenProtector(), new MutableTimeProvider(Now), publisher)
                .AddItemAsync(Writer, PublicId, 55, null));
        Assert.Empty(publisher.Changes);

        _shares.State = new PublicShareState(ShareId, CollectionId, "Trip", false, 0, CollectionSharePermission.Write);
        await new PublicCollectionWriteService(_shares, _writes, new FakeUnlockTokenProtector(), new MutableTimeProvider(Now), publisher)
            .AddItemAsync(Writer, PublicId, 55, null);
        Assert.Equal(new[] { (Writer, CollectionId) }, publisher.Changes);
        // The members also get one new-link notification that never names who added through the link.
        Assert.Equal(["items-added:7:10:1:hidden"], publisher.Events);

        // Already in the Collection: nothing new was added, so no new-link notification.
        _writes.Result = false;
        await new PublicCollectionWriteService(_shares, _writes, new FakeUnlockTokenProtector(), new MutableTimeProvider(Now), publisher)
            .AddItemAsync(Writer, PublicId, 55, null);
        Assert.Single(publisher.Events);
    }

    [Fact]
    public async Task AReadOnlyLink_RefusesEveryAdd()
    {
        _shares.State = new PublicShareState(ShareId, CollectionId, "Trip", false, 0, CollectionSharePermission.Read);

        await Assert.ThrowsAsync<PublicShareReadOnlyException>(() => Service().AddItemAsync(Writer, PublicId, 55, null));
        Assert.Null(_writes.Last);
    }

    [Fact]
    public async Task AnUnknownOrRevokedLink_IsNotFound()
    {
        _shares.State = null;

        Assert.Null(await Service().AddItemAsync(Writer, PublicId, 55, null));
        Assert.Null(_writes.Last);
    }

    [Fact]
    public async Task ALockedCollection_NeedsTheLinksUnlockGrant_JustLikeReadingIt()
    {
        _shares.State = new PublicShareState(ShareId, CollectionId, "Trip", true, 4, CollectionSharePermission.Write, CollectionSharePasswordMode.LegacyCommonLock);

        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().AddItemAsync(Writer, PublicId, 55, null));
        // A grant for a signed-in user is not the link's grant.
        var userGrant = FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(Writer), 4);
        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().AddItemAsync(Writer, PublicId, 55, userGrant));

        var linkGrant = FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForPublicShare(ShareId), 4);
        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Added, await Service().AddItemAsync(Writer, PublicId, 55, linkGrant));
    }

    [Theory]
    [InlineData("read", CollectionSharePermission.Read)]
    [InlineData(" WRITE ", CollectionSharePermission.Write)]
    public void Permission_ParsesOnlyReadAndWrite(string input, CollectionSharePermission expected)
    {
        Assert.True(PublicSharePermissions.TryParse(input, out var permission));
        Assert.Equal(expected, permission);
        Assert.False(PublicSharePermissions.TryParse("admin", out _));
        Assert.False(PublicSharePermissions.TryParse(null, out _));
    }

    [Fact]
    public void TheWriteEndpoint_RequiresAJupleUser_IsRateLimited_AndLivesOutsideTheAnonymousTree()
    {
        Assert.Equal(AuthorizationPolicies.JupleUser, typeof(PublicShareWriteController).GetCustomAttribute<AuthorizeAttribute>()?.Policy);
        var route = typeof(PublicShareWriteController).GetCustomAttribute<RouteAttribute>()!.Template;
        Assert.Equal("api/v1/public-shares/{publicId}", route);
        Assert.DoesNotContain("api/v1/public/", route);
        Assert.Equal(RateLimitPolicies.PublicCollectionWrite,
            typeof(PublicShareWriteController).GetMethod("AddItemAsync")!.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        // The anonymous controller still has no authentication and no write action.
        Assert.Null(typeof(PublicCollectionsController).GetCustomAttribute<AuthorizeAttribute>());
        Assert.DoesNotContain(typeof(PublicCollectionsController).GetMethods(), method => method.GetCustomAttribute<HttpPutAttribute>() is not null);
    }

    private sealed class StubShareStore : IPublicCollectionShareStore
    {
        public PublicShareState? State { get; set; }

        public Task<PublicShareState?> GetStateAsync(string publicId, CancellationToken cancellationToken = default) =>
            Task.FromResult(State is { IsPublic: true } ? State : null);

        public Task<PublicShareState?> GetLinkStateAsync(string publicId, CancellationToken cancellationToken = default) =>
            Task.FromResult(State);

        public Task<PublicCollectionItemPage?> GetItemsAsync(string publicId, CollectionItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class RecordingWriteStore : IPublicCollectionWriteStore
    {
        public (string PublicId, long UserId, long ItemId)? Last { get; private set; }

        public bool? Result { get; set; } = true;

        public Task<bool?> AddItemAsync(string publicId, long userId, long itemId, DateTimeOffset addedAtUtc, CancellationToken cancellationToken = default)
        {
            Last = (publicId, userId, itemId);
            return Task.FromResult(Result);
        }
    }
}
