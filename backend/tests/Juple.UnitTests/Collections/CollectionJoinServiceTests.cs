using System.Reflection;
using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Join;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
using Juple.Application.Notifications;
using Juple.Domain.Collections;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Collections;

/// <summary>The join service's decisions around the store: the link's content gate, the status mapping and who gets told.</summary>
public sealed class CollectionJoinServiceTests
{
    private const string PublicId = "pub-1";
    private const long CollectionId = 7;
    private const long Owner = 1;
    private static readonly DateTimeOffset Now = new(2026, 10, 9, 12, 0, 0, TimeSpan.Zero);

    private sealed class FakeTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class FakeShareStore(PublicShareState? state) : IPublicCollectionShareStore
    {
        public Task<PublicShareState?> GetStateAsync(string publicId, CancellationToken cancellationToken = default) =>
            Task.FromResult(state is { IsPublic: true } ? state : null);

        public Task<PublicShareState?> GetLinkStateAsync(string publicId, CancellationToken cancellationToken = default) => Task.FromResult(state);

        public Task<PublicCollectionItemPage?> GetItemsAsync(string publicId, CollectionItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class FakeMembershipStore(bool isMember) : IPublicShareMembershipStore
    {
        public Task<PublicShareMembershipDto?> GetAsync(string publicId, long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<PublicShareMembershipDto?>(new PublicShareMembershipDto(isMember, isMember ? CollectionId : null, isMember ? "viewer" : null));
    }

    private sealed class FakeJoinStore(CollectionJoinStoreResult result) : ICollectionJoinStore
    {
        public int Calls { get; private set; }

        public int SaveCalls { get; private set; }

        public Task<CollectionJoinStoreResult> RequestAsync(string publicId, long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(result);
        }

        public Task<CollectionJoinStoreResult> SavePublicAsync(string publicId, long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            SaveCalls++;
            return Task.FromResult(result);
        }

        public Task<IReadOnlyList<MyCollectionJoinRequestDto>> ListMineAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<MyCollectionJoinRequestDto>>([new MyCollectionJoinRequestDto(5, PublicId, "Trip", "Folder", null, Now)]);

        public Task<CollectionJoinRequestPage> ListPendingAsync(long collectionId, long? cursor, int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CollectionJoinRequestPage([], null));

        public Task<ResolvedCollectionJoinRequest> ApproveAsync(long ownerUserId, long collectionId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(new ResolvedCollectionJoinRequest(42, "viewer", WasObsolete: false));

        public Task<ResolvedCollectionJoinRequest?> RejectAsync(long ownerUserId, long collectionId, long requestId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult<ResolvedCollectionJoinRequest?>(new ResolvedCollectionJoinRequest(42, null, WasObsolete: false));
    }

    private sealed class FakeAccess(bool allowed) : ICollectionAccessService
    {
        public Task<CollectionAccess> RequireAsync(long userId, long collectionId, CollectionPermission permission, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionAccess> RequireUnlockedAsync(long userId, long collectionId, CollectionPermission permission, string? unlockToken, CancellationToken cancellationToken = default) =>
            allowed ? Task.FromResult(new CollectionAccess(Owner, CollectionAccessRole.Owner, false, 0)) : throw new CollectionForbiddenException();

        public Task<CollectionAccess> RequireContentAsync(long userId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    /// <summary>Records every publisher call as "name:args" (a dynamic proxy, so the long publisher interface needs no hand-written fake).</summary>
    public class RecordingNotifications : DispatchProxy
    {
        public List<string> Calls { get; } = [];

        protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
        {
            if (targetMethod!.Name == nameof(ISocialNotificationPublisher.BeginAtomicScopeAsync))
            {
                return Task.FromResult<INotificationOutboxScope>(NotificationOutbox.NoOpScope.Instance);
            }

            var name = targetMethod.Name.Replace("Async", string.Empty);
            if (name is "JoinRequestReceived")
            {
                Calls.Add($"received:{args![0]}->{args[1]}");
            }
            else if (name is "JoinRequestAnswered")
            {
                Calls.Add($"{((bool)args![4] ? "approved" : "rejected")}:{args[0]}->{args[1]}");
            }
            else if (name is "CollectionsChanged")
            {
                Calls.Add("changed");
            }
            else
            {
                Calls.Add(name);
            }

            return Task.CompletedTask;
        }
    }

    private static (ISocialNotificationPublisher Publisher, RecordingNotifications Recorder) NewRecorder()
    {
        var proxy = DispatchProxy.Create<ISocialNotificationPublisher, RecordingNotifications>();
        return (proxy, (RecordingNotifications)(object)proxy);
    }

    private static CollectionUnlockTokenProtector Tokens() => new(Options.Create(new CollectionUnlockGrantOptions
    {
        EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
    }));

    private static PublicShareState State(CollectionSharePasswordMode mode = CollectionSharePasswordMode.None, bool isPublic = false) =>
        new(5, CollectionId, "Trip", false, 0, CollectionSharePermission.Read, mode, 3, isPublic);

    private static CollectionJoinService Service(
        FakeJoinStore store, PublicShareState? state, bool isMember = false, bool ownerAccess = true, ISocialNotificationPublisher? notifications = null, CollectionUnlockTokenProtector? tokens = null) =>
        new(store, new FakeShareStore(state), new FakeMembershipStore(isMember), new FakeAccess(ownerAccess), tokens ?? Tokens(), new FakeTime(), notifications);

    [Fact]
    public async Task AnUnknownLink_IsUnavailable_AndTheStoreIsNeverTouched()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Requested));
        Assert.Null(await Service(store, null).RequestAsync(9, PublicId, null));
        Assert.Equal(0, store.Calls);
    }

    [Fact]
    public async Task ALinkWithAPassword_NeedsItsGrant_ForANonMember_AndThePasswordNeverMakesAnyoneAMember()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Requested, CollectionId, Owner, RequestId: 3));
        var service = Service(store, State(CollectionSharePasswordMode.PerCollection));

        await Assert.ThrowsAsync<CollectionLockedException>(() => service.RequestAsync(9, PublicId, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => service.RequestAsync(9, PublicId, "garbage"));
        Assert.Equal(0, store.Calls);
    }

    [Fact]
    public async Task WithTheGrant_TheRequestProceeds_AndIsStillOnlyARequest()
    {
        var tokens = Tokens();
        var grant = tokens.Issue(CollectionId, CollectionUnlockSubject.ForPublicShare(5), 3, Now, CollectionUnlockPurpose.SharePassword);
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Requested, CollectionId, Owner, RequestId: 3));

        var result = await Service(store, State(CollectionSharePasswordMode.PerCollection), tokens: tokens).RequestAsync(9, PublicId, grant.Token);

        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.Requested, null, null), result);
    }

    [Fact]
    public async Task AMemberOfAProtectedLink_IsNotAskedForTheLinksPassword()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyMember, CollectionId, Owner, "viewer"));

        var result = await Service(store, State(CollectionSharePasswordMode.PerCollection), isMember: true).RequestAsync(9, PublicId, null);

        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.AlreadyMember, CollectionId, "viewer"), result);
    }

    [Fact]
    public async Task APublicLink_NeedsNoRequest_ItIsAConflictNotASilentSuccess()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.NotAllowed, CollectionId, Owner));
        var exception = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => Service(store, State(isPublic: true)).RequestAsync(9, PublicId, null));
        Assert.Equal(CollectionCollaborationConflictException.JoinNotAllowed, exception.Code);
    }

    [Fact]
    public async Task ARequestTellsTheOwnerOnce_AStillWaitingOneTellsNobody_AndNeitherRevealsTheCollection()
    {
        var (notifications, recorder) = NewRecorder();
        var created = Service(new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Requested, CollectionId, Owner, RequestId: 11)), State(), notifications: notifications);
        var again = Service(new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyRequested, CollectionId, Owner, RequestId: 11)), State(), notifications: notifications);

        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.Requested, null, null), await created.RequestAsync(9, PublicId, null));
        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.AlreadyRequested, null, null), await again.RequestAsync(9, PublicId, null));

        Assert.Equal(["received:9->1"], recorder.Calls);
    }

    [Fact]
    public async Task OnlyTheOwnerManagesRequests_AndAnswersTellTheRequester()
    {
        var (notifications, recorder) = NewRecorder();
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Requested));

        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service(store, State(), ownerAccess: false).ListAsync(2, CollectionId, null, 20, null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service(store, State(), ownerAccess: false).ApproveAsync(2, CollectionId, 11, null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service(store, State(), ownerAccess: false).RejectAsync(2, CollectionId, 11, null));

        var owner = Service(store, State(), notifications: notifications);
        await owner.ApproveAsync(Owner, CollectionId, 11, null);
        await owner.RejectAsync(Owner, CollectionId, 12, null);

        Assert.Equal(["changed", "approved:1->42", "rejected:1->42"], recorder.Calls);
    }

    [Fact]
    public async Task TheRequestersOwnWaitingRequests_AreListedForThemSelves()
    {
        var mine = await Service(new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Requested)), State()).ListMineAsync(9);

        Assert.Equal(["Trip"], mine.Select(item => item.Name));
    }

    [Fact]
    public void TheServiceOffersRequestSaveListAndAnswer_AndNoRoleOrModeParameterAnywhere()
    {
        var methods = typeof(ICollectionJoinService).GetMethods().Select(method => method.Name).OrderBy(name => name).ToList();

        Assert.Equal(["ApproveAsync", "ListAsync", "ListMineAsync", "RejectAsync", "RequestAsync", "SavePublicAsync"], methods);
        // Membership policy comes from IsPublic alone: no method takes a role, a permission or a mode.
        foreach (var method in typeof(ICollectionJoinService).GetMethods().Concat(typeof(ICollectionJoinStore).GetMethods()))
        {
            Assert.DoesNotContain(method.GetParameters(), parameter =>
                parameter.ParameterType == typeof(CollectionSharePermission) || parameter.ParameterType == typeof(CollectionCollaboratorRole)
                || parameter.Name!.Contains("role", StringComparison.OrdinalIgnoreCase) || parameter.Name.Contains("mode", StringComparison.OrdinalIgnoreCase));
        }
    }

    // ---------- 컬렉션 추가 (save a PUBLIC Collection) ----------

    [Fact]
    public async Task SavingAPublicCollection_MakesAViewer_AndTellsNobodyToApprove()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Joined, CollectionId, Owner, "viewer"));
        var (publisher, recorder) = NewRecorder();

        var result = await Service(store, State(isPublic: true), notifications: publisher).SavePublicAsync(9, PublicId, null);

        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.Joined, CollectionId, "viewer"), result);
        Assert.Equal(1, store.SaveCalls);
        Assert.Equal(0, store.Calls); // never a request
        Assert.DoesNotContain(recorder.Calls, call => call.StartsWith("received", StringComparison.Ordinal));
    }

    [Fact]
    public async Task SavingTwice_OrAsAMember_IsAlreadyMember_NeverASecondRow()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.AlreadyMember, CollectionId, Owner, "viewer"));

        var result = await Service(store, State(isPublic: true)).SavePublicAsync(9, PublicId, null);

        Assert.Equal(new CollectionJoinResultDto(CollectionJoinOutcomes.AlreadyMember, CollectionId, "viewer"), result);
    }

    [Fact]
    public async Task SavingAPrivateLink_OrOneTurnedPrivateMeanwhile_IsRefused()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.NotAllowed, CollectionId, Owner));

        var exception = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => Service(store, State(isPublic: false)).SavePublicAsync(9, PublicId, null));

        Assert.Equal(CollectionCollaborationConflictException.JoinNotAllowed, exception.Code);
    }

    [Fact]
    public async Task SavingAnUnknownOrRevokedLink_IsUnavailable_AndTheStoreIsNeverTouched()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Joined));

        Assert.Null(await Service(store, null).SavePublicAsync(9, PublicId, null));
        Assert.Equal(0, store.SaveCalls);
    }

    [Fact]
    public async Task SavingAPasswordProtectedLink_NeedsTheGrantFirst_AndThePasswordSavesNothing()
    {
        var store = new FakeJoinStore(new CollectionJoinStoreResult(CollectionJoinStoreStatus.Joined, CollectionId, Owner, "viewer"));
        var service = Service(store, State(CollectionSharePasswordMode.PerCollection, isPublic: true));

        await Assert.ThrowsAsync<CollectionLockedException>(() => service.SavePublicAsync(9, PublicId, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => service.SavePublicAsync(9, PublicId, "garbage"));
        Assert.Equal(0, store.SaveCalls);
    }
}
