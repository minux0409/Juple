using System.Reflection;
using System.Text.Json;
using Juple.Api.Billing;
using Juple.Api.Controllers;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;
using Juple.Domain.Collections;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;

namespace Juple.UnitTests.Billing;

public sealed class EntitlementAccessPolicyTests
{
    private static readonly TrialWindow Window = new(
        new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero), new DateTimeOffset(2026, 12, 31, 0, 0, 0, TimeSpan.Zero));

    private static Entitlement Live(EntitlementStatus status, DateTimeOffset now) => status == EntitlementStatus.Trial
        ? Entitlement.ForTrial(Window, Window.StartedAtUtc.AddDays(1))
        : Entitlement.Paid(status, now.AddDays(20), EntitlementReason.None, Window, now);

    private static readonly DateTimeOffset Later = new(2027, 2, 1, 0, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(EntitlementStatus.Trial)]
    [InlineData(EntitlementStatus.Active)]
    [InlineData(EntitlementStatus.GracePeriod)]
    public void ALiveViewer_CanWrite_AndHasNoFreezeBoundary(EntitlementStatus status)
    {
        var entitlement = Live(status, Later);

        Assert.True(EntitlementAccessPolicy.CanWrite(entitlement));
        Assert.Null(EntitlementAccessPolicy.SharedContentVisibleThroughUtc(entitlement));
    }

    [Fact]
    public void TheProgramNotLaunched_HasNoBoundaryAndNoRestriction()
    {
        var entitlement = Entitlement.NotLaunched(Later);

        Assert.True(EntitlementAccessPolicy.CanWrite(entitlement));
        Assert.Null(EntitlementAccessPolicy.SharedContentVisibleThroughUtc(entitlement));
    }

    [Fact]
    public void AnExpiredViewer_CannotWrite_AndSeesSharedContentOnlyThroughTheFreezeInstant()
    {
        var entitlement = Entitlement.ForTrial(Window, Window.EndsAtUtc.AddDays(60));

        Assert.False(EntitlementAccessPolicy.CanWrite(entitlement));
        Assert.Equal(Window.EndsAtUtc, EntitlementAccessPolicy.SharedContentVisibleThroughUtc(entitlement));
    }

    [Fact]
    public void TheViewersOwnEntitlementDecides_AnExpiredOwnerDoesNotFreezeAnActiveMember_AndViceVersa()
    {
        var expiredOwner = Entitlement.ForTrial(Window, Window.EndsAtUtc.AddDays(10));
        var activeMember = Entitlement.Paid(EntitlementStatus.Active, Later, EntitlementReason.None, Window, Window.EndsAtUtc.AddDays(10));
        var activeOwner = activeMember;
        var expiredMember = expiredOwner;

        // Owner expired, Contributor active: the contributor keeps seeing everything; the owner has a frozen view.
        Assert.Null(EntitlementAccessPolicy.SharedContentVisibleThroughUtc(activeMember));
        Assert.NotNull(EntitlementAccessPolicy.SharedContentVisibleThroughUtc(expiredOwner));

        // Owner active, member expired: only the expired viewer is frozen.
        Assert.Null(EntitlementAccessPolicy.SharedContentVisibleThroughUtc(activeOwner));
        Assert.NotNull(EntitlementAccessPolicy.SharedContentVisibleThroughUtc(expiredMember));
    }

    [Fact]
    public void AResubscribedViewer_HasNoBoundaryAgain_WithoutAnyCatchUp()
    {
        var expired = Entitlement.ForTrial(Window, Window.EndsAtUtc.AddDays(60));
        var resubscribed = Entitlement.Paid(EntitlementStatus.Active, Later, EntitlementReason.None, Window, Window.EndsAtUtc.AddDays(61));

        Assert.NotNull(EntitlementAccessPolicy.SharedContentVisibleThroughUtc(expired));
        Assert.Null(EntitlementAccessPolicy.SharedContentVisibleThroughUtc(resubscribed));
        Assert.True(EntitlementAccessPolicy.CanWrite(resubscribed));
        Assert.Null(resubscribed.AccessFrozenAtUtc);
    }
}

public sealed class SharedContentFreezeTests
{
    private static readonly DateTimeOffset Frozen = new(2026, 12, 31, 0, 0, 0, TimeSpan.Zero);

    /// <summary>A membership with distinct browsing time (AddedAtUtc) and visibility time (VisibleSinceUtc).</summary>
    private static CollectionItem Membership(long itemId, DateTimeOffset addedAtUtc, DateTimeOffset visibleSinceUtc) =>
        new(collectionId: 1, itemId, addedByUserId: 5, addedAtUtc, visibleSinceUtc, sortOrder: 0);

    private static CollectionItem Membership(long itemId, DateTimeOffset at) => Membership(itemId, at, at);

    [Fact]
    public void WithoutABoundary_EverythingIsVisible()
    {
        var memberships = new[] { Membership(1, Frozen.AddDays(-5)), Membership(2, Frozen.AddDays(5)) }.AsQueryable();

        Assert.Equal([1L, 2L], memberships.WhereVisibleThrough(null).Select(item => item.ItemId));
    }

    [Fact]
    public void ABoundary_HidesOnlyWhatBecameVisibleAfterIt_AndKeepsTheBoundaryInstantItself()
    {
        var memberships = new[]
        {
            Membership(1, Frozen.AddDays(-5)),
            Membership(2, Frozen),
            Membership(3, Frozen.AddTicks(1)),
            Membership(4, Frozen.AddDays(5)),
        }.AsQueryable();

        Assert.Equal([1L, 2L], memberships.WhereVisibleThrough(Frozen).Select(item => item.ItemId));
        Assert.True(SharedContentFreeze.IsVisibleThrough(Frozen, Frozen));
        Assert.False(SharedContentFreeze.IsVisibleThrough(Frozen.AddTicks(1), Frozen));
        Assert.True(SharedContentFreeze.IsVisibleThrough(Frozen.AddDays(99), null));
    }

    [Fact]
    public void TheRuleReadsVisibleSinceUtc_NeverAddedAtUtc()
    {
        // An OLD browsing time but a NEW visibility time (a link copied in after the freeze) is hidden;
        // a NEW browsing time but an OLD visibility time is visible. Only VisibleSinceUtc decides.
        var copiedInAfterFreeze = Membership(1, addedAtUtc: Frozen.AddDays(-90), visibleSinceUtc: Frozen.AddDays(3));
        var oldContentWithLaterBrowsingDate = Membership(2, addedAtUtc: Frozen.AddDays(40), visibleSinceUtc: Frozen.AddDays(-3));
        var memberships = new[] { copiedInAfterFreeze, oldContentWithLaterBrowsingDate }.AsQueryable();

        Assert.Equal([2L], memberships.WhereVisibleThrough(Frozen).Select(item => item.ItemId));
    }

    [Fact]
    public void ADirectAdd_IsVisibleWhenTheFreezeIsAfterIt_AndHiddenWhenTheFreezeIsBeforeIt()
    {
        var addedAt = new DateTimeOffset(2026, 12, 10, 0, 0, 0, TimeSpan.Zero);
        var membership = CollectionItem.CreateNew(1, 1, 5, addedAt, 0);
        var memberships = new[] { membership }.AsQueryable();

        Assert.Equal(addedAt, membership.VisibleSinceUtc);
        Assert.Single(memberships.WhereVisibleThrough(addedAt.AddDays(1)));
        Assert.Single(memberships.WhereVisibleThrough(addedAt));
        Assert.Empty(memberships.WhereVisibleThrough(addedAt.AddDays(-1)));
    }

    [Fact]
    public void AProposalMadeBeforeTheFreezeButApprovedAfterIt_IsNewSharedContent()
    {
        // T1 proposed < T2 freeze < T3 approved. The membership is created at approval (VisibleSinceUtc = T3); the proposal's
        // submission time T1 never reaches it.
        var proposed = Frozen.AddDays(-3);
        var approved = Frozen.AddDays(2);
        Assert.True(proposed < Frozen && Frozen < approved);
        var membership = CollectionItem.CreateNew(1, 10, 5, approved, 0);

        Assert.Equal(approved, membership.VisibleSinceUtc);
        Assert.Empty(new[] { membership }.AsQueryable().WhereVisibleThrough(Frozen));
    }

    [Fact]
    public void ACopyOrMoveTarget_KeepsTheOldBrowsingDate_ButIsPostFreezeContent()
    {
        var original = Frozen.AddDays(-60);
        var copiedAt = Frozen.AddDays(4);
        var target = new CollectionItem(collectionId: 2, itemId: 7, addedByUserId: 5, addedAtUtc: original, visibleSinceUtc: copiedAt, sortOrder: 0);

        Assert.Equal(original, target.AddedAtUtc);
        Assert.Equal(copiedAt, target.VisibleSinceUtc);
        Assert.Empty(new[] { target }.AsQueryable().WhereVisibleThrough(Frozen));
        // The source membership (untouched) stays visible to the same frozen viewer.
        Assert.Single(new[] { Membership(7, original) }.AsQueryable().WhereVisibleThrough(Frozen));
    }

    [Fact]
    public void ResubscribingNeedsNoCatchUp_TheSameRowsAreSimplyVisibleAgain()
    {
        var memberships = new[] { Membership(1, Frozen.AddDays(-5)), Membership(2, Frozen.AddDays(5)) }.AsQueryable();

        Assert.Single(memberships.WhereVisibleThrough(Frozen));
        Assert.Equal(2, memberships.WhereVisibleThrough(null).Count());
    }

    [Fact]
    public void CreateNew_SetsBothTimestampsToTheCreationInstant()
    {
        var now = new DateTimeOffset(2026, 12, 20, 3, 4, 5, TimeSpan.Zero);

        var membership = CollectionItem.CreateNew(1, 2, 3, now, 4, addedViaPublicShare: true);

        Assert.Equal(now, membership.AddedAtUtc);
        Assert.Equal(now, membership.VisibleSinceUtc);
        Assert.True(membership.AddedViaPublicShare);
    }
}

public sealed class WriteAccessFilterTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 5, 0, 0, 0, TimeSpan.Zero);
    private static readonly TrialWindow Window = new(Now.AddDays(-40), Now.AddDays(-10));

    private sealed class FixedIdentity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class NoUsers : Juple.Application.Users.CurrentUser.ICurrentJupleUserAccessor
    {
        public Task<Juple.Application.Users.CurrentUser.CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("No Collection-owned metadata in these tests - the actor lookup must not be needed.");
    }

    private sealed class NoOwners : ICollectionOwnerLookup
    {
        public Task<long?> FindOwnerUserIdAsync(long collectionId, CancellationToken cancellationToken = default) => Task.FromResult<long?>(null);

        public Task<long?> FindOwnerUserIdByPublicIdAsync(string publicId, CancellationToken cancellationToken = default) => Task.FromResult<long?>(null);

        public Task<long?> FindOwnerUserIdByInvitationAsync(long invitationId, CancellationToken cancellationToken = default) => Task.FromResult<long?>(null);

        public Task<IReadOnlyCollection<long>> FindOwnerUserIdsByMergeOperationAsync(Guid operationToken, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyCollection<long>>([]);
    }

    private sealed class FixedEntitlements(Entitlement? entitlement, bool notBootstrapped = false) : IEntitlementService
    {
        public int Reads { get; private set; }

        public Task<Entitlement> GetForUserAsync(long userId, CancellationToken cancellationToken = default) => Read();

        public Task<Entitlement> GetForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) => Read();

        public Task<StoreSubscriptionOwnership> GetStoreSubscriptionForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(StoreSubscriptionOwnership.None);

        private Task<Entitlement> Read()
        {
            Reads++;
            return notBootstrapped ? throw new CurrentJupleUserNotFoundException() : Task.FromResult(entitlement!);
        }
    }

    private static ActionExecutingContext Context(params object[] endpointMetadata) => ContextFor("POST", authenticated: true, endpointMetadata);

    private static ActionExecutingContext ContextFor(string method, bool authenticated, params object[] endpointMetadata)
    {
        var descriptor = new ActionDescriptor { EndpointMetadata = endpointMetadata };
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Method = method;
        if (authenticated)
        {
            httpContext.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity("test"));
        }

        return new ActionExecutingContext(
            new ActionContext(httpContext, new RouteData(), descriptor),
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());
    }

    private static async Task<(bool NextCalled, IActionResult? Result)> RunAsync(BillingOptions options, FixedEntitlements entitlements, ActionExecutingContext context)
    {
        var nextCalled = false;
        await new RequireWriteAccessFilter(options, new FixedIdentity(), entitlements, new NoUsers(), new NoOwners()).OnActionExecutionAsync(
            context,
            () =>
            {
                nextCalled = true;
                return Task.FromResult(new ActionExecutedContext(context, context.Filters, context.Controller));
            });
        return (nextCalled, context.Result);
    }

    private static BillingOptions Enabled() => new() { ProgramEnabled = true, ProgramStartAtUtc = DateTimeOffset.UnixEpoch };

    [Fact]
    public async Task ProgramDisabled_ARestrictedMutationStaysAllowed_AndNothingIsEvenRead()
    {
        // Even an entitlement that WOULD block is never consulted while the program is not launched.
        var entitlements = new FixedEntitlements(Entitlement.ForTrial(Window, Now));

        var (nextCalled, result) = await RunAsync(new BillingOptions(), entitlements, Context());

        Assert.True(nextCalled);
        Assert.Null(result);
        Assert.Equal(0, entitlements.Reads);
    }

    [Fact]
    public async Task ProgramEnabled_ATrialAccount_IsAllowed()
    {
        var entitlements = new FixedEntitlements(Entitlement.ForTrial(new TrialWindow(Now.AddDays(-1), Now.AddDays(29)), Now));

        var (nextCalled, result) = await RunAsync(Enabled(), entitlements, Context());

        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task ProgramEnabled_AnExpiredAccount_GetsTheSubscriptionRequiredOutcome()
    {
        var entitlements = new FixedEntitlements(Entitlement.ForTrial(Window, Now));

        var (nextCalled, result) = await RunAsync(Enabled(), entitlements, Context());

        Assert.False(nextCalled);
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, objectResult.StatusCode);
        var problem = Assert.IsType<ProblemDetails>(objectResult.Value);
        Assert.Equal("subscriptionRequired", problem.Extensions["code"]);
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("HEAD")]
    [InlineData("OPTIONS")]
    public async Task ProgramEnabled_AnExpiredAccount_KeepsEveryRead_ANeverGatedMethod(string method)
    {
        var entitlements = new FixedEntitlements(Entitlement.ForTrial(Window, Now));

        var (nextCalled, result) = await RunAsync(Enabled(), entitlements, ContextFor(method, authenticated: true));

        Assert.True(nextCalled);
        Assert.Null(result);
        Assert.Equal(0, entitlements.Reads);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task ProgramEnabled_AnExpiredAccount_IsStoppedOnEveryMutatingMethod(string method)
    {
        var entitlements = new FixedEntitlements(Entitlement.ForTrial(Window, Now));

        var (nextCalled, result) = await RunAsync(Enabled(), entitlements, ContextFor(method, authenticated: true));

        Assert.False(nextCalled);
        Assert.IsType<ObjectResult>(result);
    }

    [Fact]
    public async Task ProgramEnabled_AnAnonymousRequest_IsNeverGatedHere()
    {
        var entitlements = new FixedEntitlements(Entitlement.ForTrial(Window, Now));

        var (nextCalled, result) = await RunAsync(Enabled(), entitlements, ContextFor("POST", authenticated: false));

        Assert.True(nextCalled);
        Assert.Null(result);
        Assert.Equal(0, entitlements.Reads);
    }

    [Fact]
    public async Task ProgramEnabled_AnEndpointMarkedAllowWhenExpired_StaysUsable_TheEscapeHatch()
    {
        var entitlements = new FixedEntitlements(Entitlement.ForTrial(Window, Now));

        var (nextCalled, result) = await RunAsync(Enabled(), entitlements, Context(new AllowWhenSubscriptionExpiredAttribute()));

        Assert.True(nextCalled);
        Assert.Null(result);
        Assert.Equal(0, entitlements.Reads);
    }

    [Fact]
    public async Task ProgramEnabled_AnAccountThatIsNotBootstrapped_IsLeftToTheActionsOwnAnswer()
    {
        var (nextCalled, result) = await RunAsync(Enabled(), new FixedEntitlements(null, notBootstrapped: true), Context());

        Assert.True(nextCalled);
        Assert.Null(result);
    }
}

/// <summary>
/// Makes the FUTURE expired-write allowlist explicit, and proves enforcement is not applied anywhere yet (R39-D turns it on).
/// </summary>
public sealed class ExpiredWriteAllowlistTests
{
    private static IEnumerable<Type> Controllers() => typeof(AccountController).Assembly.GetTypes()
        .Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract);

    private static readonly Type[] MutatingVerbs = [typeof(HttpPostAttribute), typeof(HttpPutAttribute), typeof(HttpPatchAttribute), typeof(HttpDeleteAttribute)];

    private static IEnumerable<MethodInfo> MutatingActions(Type controller) => controller
        .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
        .Where(method => MutatingVerbs.Any(verb => method.GetCustomAttribute(verb) is not null));

    private static bool IsAuthenticatedController(Type controller) => controller.GetCustomAttribute<AuthorizeAttribute>() is not null;

    [Fact]
    public void TheControllersWhoseWholeSurfaceStaysUsableWhenExpired_AreExactlyTheseControllers()
    {
        var allowed = Controllers()
            .Where(type => type.GetCustomAttribute<AllowWhenSubscriptionExpiredAttribute>() is not null)
            .Select(type => type.Name)
            .Order()
            .ToArray();

        // account deletion, support, the bootstrap/session plumbing, push-device registration and billing - plus the settings and
        // read-state controllers (lock password, per-Collection notification preference, notifications, recently opened links,
        // URL metadata lookup, profile) that change no shared content.
        Assert.Equal(
            [
                "AccountController", "AuthSessionController", "CollectionLockSettingsController", "CollectionNotificationPreferencesController",
                "CurrentUserBootstrapController", "GoogleBillingController", "NotificationsController", "PushDevicesController",
                "RecentlyOpenedLinksController", "SupportInquiriesController", "UrlMetadataController", "UserProfileController",
            ],
            allowed);
    }

    [Fact]
    public void TheControllersThatGateContentWrites_AreExactlyTheseControllers()
    {
        var gated = Controllers()
            .Where(type => type.GetCustomAttribute<RequireWriteAccessAttribute>() is not null)
            .Select(type => type.Name)
            .Order()
            .ToArray();

        Assert.Equal(
            [
                "CollectionInvitationsController", "CollectionItemCopyController", "CollectionsController", "FriendsController", "InboxController",
                "ItemCollectionsController", "ItemImagesController", "ItemsController", "PublicShareWriteController",
            ],
            gated);
    }

    private static bool IsAnonymousAction(Type controller, MethodInfo method) =>
        controller.GetCustomAttribute<AuthorizeAttribute>() is null || method.GetCustomAttribute<AllowAnonymousAttribute>() is not null;

    [Fact]
    public void EveryAnonymousMutatingAction_HasBeenReviewedAndIsListedHere()
    {
        var anonymous = Controllers()
            .SelectMany(controller => MutatingActions(controller).Where(method => IsAnonymousAction(controller, method)).Select(method => (controller, method)))
            .ToArray();

        // The filter never gates an anonymous caller (there is no account to check), so each anonymous mutation must be a reviewed,
        // deliberate exception - never an endpoint that merely slipped past the decision.
        var unreviewed = anonymous
            .Where(entry => entry.method.GetCustomAttribute<AnonymousMutationReviewedAttribute>() is null)
            .Select(entry => $"{entry.controller.Name}.{entry.method.Name}")
            .ToArray();
        Assert.Empty(unreviewed);

        Assert.Equal(
            ["GoogleRtdnController", "PublicCollectionsController"],
            anonymous.Select(entry => entry.controller.Name).Distinct().Order(StringComparer.Ordinal).ToArray());
        Assert.All(anonymous, entry => Assert.False(string.IsNullOrWhiteSpace(entry.method.GetCustomAttribute<AnonymousMutationReviewedAttribute>()!.Reason)));
    }

    [Fact]
    public void TheWritesThatActOnACollection_NameWhereTheCollectionComesFrom()
    {
        var owned = Controllers()
            .Where(type => type.GetCustomAttribute<CollectionOwnedWriteAttribute>() is not null)
            .Select(type => type.Name)
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            ["CollectionItemCopyController", "CollectionsController", "InboxController", "ItemCollectionsController", "PublicShareWriteController"],
            owned);
        // Every Collection-owned controller is also an actor-gated one: the owner check only ever ADDS to the actor check.
        Assert.All(
            Controllers().Where(type => type.GetCustomAttribute<CollectionOwnedWriteAttribute>() is not null),
            type => Assert.NotNull(type.GetCustomAttribute<RequireWriteAccessAttribute>()));
    }

    [Fact]
    public void EveryMutatingActionOfAnAuthenticatedController_IsEitherGatedOrExplicitlyAllowed()
    {
        var undecided = Controllers()
            .Where(IsAuthenticatedController)
            .SelectMany(controller => MutatingActions(controller).Select(method => (controller, method)))
            .Where(entry =>
            {
                var gated = entry.controller.GetCustomAttribute<RequireWriteAccessAttribute>() is not null;
                var allowed = entry.controller.GetCustomAttribute<AllowWhenSubscriptionExpiredAttribute>() is not null
                    || entry.method.GetCustomAttribute<AllowWhenSubscriptionExpiredAttribute>() is not null;
                return !gated && !allowed;
            })
            .Select(entry => $"{entry.controller.Name}.{entry.method.Name}")
            .ToArray();

        // A new write endpoint must choose: gate it (class-level RequireWriteAccess) or mark it AllowWhenSubscriptionExpired.
        Assert.Empty(undecided);
    }

    [Fact]
    public void TheContentWritesAnExpiredPersonStillMayDo_AreExactlyThese()
    {
        var allowedInsideGatedControllers = Controllers()
            .Where(type => type.GetCustomAttribute<RequireWriteAccessAttribute>() is not null)
            .SelectMany(controller => MutatingActions(controller)
                .Where(method => method.GetCustomAttribute<AllowWhenSubscriptionExpiredAttribute>() is not null)
                .Select(method => $"{controller.Name[..^"Controller".Length]}: {method.GetCustomAttributes().OfType<HttpMethodAttribute>().First().HttpMethods.First()} {method.GetCustomAttributes().OfType<HttpMethodAttribute>().First().Template}"))
            .Order()
            .ToArray();

        // Reading-like POSTs (unlock, reveal, lookup, open), protective or personal choices (favorite, lock, stop sharing, decline,
        // cancel my own request, leave) - none of them adds or changes anyone's links or Collections.
        Assert.Equal(
            new[]
            {
                "CollectionInvitations: POST collection-invitations/{invitationId:long}/decline",
                "CollectionInvitations: POST users/lookup-by-juple-id",
                "Collections: DELETE submissions/mine/{submissionId:long}",
                "Collections: DELETE {id:long}/collaborators/me",
                "Collections: DELETE {id:long}/share",
                "Collections: POST {id:long}/lock/remove",
                "Collections: POST {id:long}/share-password/reveal",
                "Collections: POST {id:long}/share-password/unlock",
                "Collections: POST {id:long}/unlock",
                "Collections: PUT {id:long}/favorite",
                "Collections: PUT {id:long}/lock",
                "Friends: DELETE requests/{requestId:long}",
                "Friends: DELETE {friendshipId:long}",
                "Friends: POST requests/{requestId:long}/decline",
                "Items: POST {id:long}/open",
                "PublicShareWrite: DELETE submissions/mine/{submissionId:long}",
            }.Order(StringComparer.Ordinal).ToArray(),
            allowedInsideGatedControllers.Order(StringComparer.Ordinal).ToArray());
    }
}

public sealed class OwnerLevelWriteGateTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 5, 0, 0, 0, TimeSpan.Zero);
    private static readonly Entitlement Active = Entitlement.ForTrial(new TrialWindow(Now.AddDays(-1), Now.AddDays(29)), Now);
    private static readonly Entitlement Expired = Entitlement.ForTrial(new TrialWindow(Now.AddDays(-40), Now.AddDays(-10)), Now);

    private const long ActorId = 1;
    private const long OwnerId = 2;
    private const long CollectionId = 50;

    private sealed class Identity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class Users : Juple.Application.Users.CurrentUser.ICurrentJupleUserAccessor
    {
        public Task<Juple.Application.Users.CurrentUser.CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(new Juple.Application.Users.CurrentUser.CurrentJupleUser(ActorId, "UTC", default));
    }

    private sealed class Entitlements(Entitlement actor, Entitlement owner) : IEntitlementService
    {
        public List<long> UserReads { get; } = [];

        public Task<Entitlement> GetForUserAsync(long userId, CancellationToken cancellationToken = default)
        {
            UserReads.Add(userId);
            return Task.FromResult(userId == OwnerId ? owner : actor);
        }

        public Task<Entitlement> GetForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) => Task.FromResult(actor);

        public Task<StoreSubscriptionOwnership> GetStoreSubscriptionForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(StoreSubscriptionOwnership.None);
    }

    private sealed class Owners(long? collectionOwner, long? publicOwner = null, long? invitationOwner = null, long[]? mergeOwners = null) : ICollectionOwnerLookup
    {
        public Task<long?> FindOwnerUserIdByInvitationAsync(long invitationId, CancellationToken cancellationToken = default) => Task.FromResult(invitationOwner);

        public Task<IReadOnlyCollection<long>> FindOwnerUserIdsByMergeOperationAsync(Guid operationToken, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyCollection<long>>(mergeOwners ?? []);

        public Task<long?> FindOwnerUserIdAsync(long collectionId, CancellationToken cancellationToken = default) =>
            Task.FromResult(collectionId == CollectionId ? collectionOwner : null);

        public Task<long?> FindOwnerUserIdByPublicIdAsync(string publicId, CancellationToken cancellationToken = default) => Task.FromResult(publicOwner);
    }

    private sealed record TransferRequest(long TargetCollectionId);

    private sealed record ManyRequest(IReadOnlyList<long>? CollectionIds);

    private static async Task<(bool NextCalled, IActionResult? Result)> RunAsync(
        Entitlement actor,
        Entitlement owner,
        long? collectionOwner,
        string method = "POST",
        long? invitationOwner = null,
        long[]? mergeOwners = null,
        Action<ActionExecutingContext>? configure = null,
        BillingOptions? options = null,
        params object[] metadata)
    {
        var allMetadata = metadata.Length == 0
            ? [new CollectionOwnedWriteAttribute { RouteIds = ["id"], RequestProperties = ["TargetCollectionId", "CollectionIds"], PublicIdRoute = "publicId" }]
            : metadata;
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Method = method;
        httpContext.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity("test"));
        var context = new ActionExecutingContext(
            new ActionContext(httpContext, new RouteData(), new ActionDescriptor { EndpointMetadata = allMetadata }),
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());
        context.RouteData.Values["id"] = CollectionId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        configure?.Invoke(context);

        var nextCalled = false;
        await new RequireWriteAccessFilter(
            options ?? new BillingOptions { ProgramEnabled = true, ProgramStartAtUtc = DateTimeOffset.UnixEpoch },
            new Identity(),
            new Entitlements(actor, owner),
            new Users(),
            new Owners(collectionOwner, invitationOwner: invitationOwner, mergeOwners: mergeOwners)).OnActionExecutionAsync(
            context,
            () =>
            {
                nextCalled = true;
                return Task.FromResult(new ActionExecutedContext(context, context.Filters, context.Controller));
            });
        return (nextCalled, context.Result);
    }

    private static string CodeOf(IActionResult? result) =>
        (string)Assert.IsType<ProblemDetails>(Assert.IsType<ObjectResult>(result).Value).Extensions["code"]!;

    [Fact]
    public async Task ProgramDisabled_EveryCombination_StaysAllowed()
    {
        foreach (var actor in new[] { Active, Expired })
        {
            foreach (var owner in new[] { Active, Expired })
            {
                var (nextCalled, result) = await RunAsync(actor, owner, OwnerId, options: new BillingOptions());
                Assert.True(nextCalled);
                Assert.Null(result);
            }
        }
    }

    [Fact]
    public async Task ActiveActor_ActiveOwner_IsAllowed()
    {
        var (nextCalled, result) = await RunAsync(Active, Active, OwnerId);
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task ActiveActor_ExpiredOwner_IsBlocked_WithTheOwnerSpecificCode()
    {
        var (nextCalled, result) = await RunAsync(Active, Expired, OwnerId);
        Assert.False(nextCalled);
        Assert.Equal(StatusCodes.Status403Forbidden, Assert.IsType<ObjectResult>(result).StatusCode);
        Assert.Equal("collectionOwnerSubscriptionRequired", CodeOf(result));
    }

    [Fact]
    public async Task ExpiredActor_ActiveOwner_IsBlocked_WithTheActorsOwnCode()
    {
        var (nextCalled, result) = await RunAsync(Expired, Active, OwnerId);
        Assert.False(nextCalled);
        Assert.Equal("subscriptionRequired", CodeOf(result));
    }

    [Fact]
    public async Task TheOwnerWritingToTheirOwnCollection_NeedsOnlyOneCheck()
    {
        // actor == owner: the same person, so the actor's entitlement alone decides - the (here expired) owner entry is never consulted.
        var (nextCalled, result) = await RunAsync(Active, Expired, ActorId);
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task ExpiredOwnerOwnWrite_IsBlockedByTheActorCheck()
    {
        var (nextCalled, result) = await RunAsync(Expired, Expired, ActorId);
        Assert.False(nextCalled);
        Assert.Equal("subscriptionRequired", CodeOf(result));
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("HEAD")]
    public async Task ExpiredOwner_ReadsOfTheirCollection_StayAllowed(string method)
    {
        var (nextCalled, result) = await RunAsync(Active, Expired, OwnerId, method);
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task AllowlistedAction_StaysUsable_EvenWithAnExpiredOwner_AndAnExpiredActor()
    {
        // leave / decline / cancel / stop sharing / unlock: neither the actor's nor the owner's state matters.
        var (nextCalled, result) = await RunAsync(
            Expired, Expired, OwnerId,
            metadata: [new CollectionOwnedWriteAttribute { RouteIds = ["id"] }, new AllowWhenSubscriptionExpiredAttribute()]);
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task ATargetCollectionInTheRequestBody_IsChecked_NotJustTheRoute()
    {
        // The route Collection is the actor's own; the TARGET (move / merge / copy destination) belongs to an expired owner.
        var (nextCalled, result) = await RunAsync(
            Active, Expired, collectionOwner: OwnerId,
            configure: context =>
            {
                context.RouteData.Values.Remove("id");
                context.ActionArguments["request"] = new TransferRequest(CollectionId);
            });
        Assert.False(nextCalled);
        Assert.Equal("collectionOwnerSubscriptionRequired", CodeOf(result));
    }

    [Fact]
    public async Task EveryCollectionInAListOfIds_IsChecked()
    {
        var (nextCalled, result) = await RunAsync(
            Active, Expired, collectionOwner: OwnerId,
            configure: context =>
            {
                context.RouteData.Values.Remove("id");
                context.ActionArguments["request"] = new ManyRequest([999, CollectionId]);
            });
        Assert.False(nextCalled);
        Assert.Equal("collectionOwnerSubscriptionRequired", CodeOf(result));
    }

    [Fact]
    public async Task AnUnknownCollection_IsLeftToTheActionsOwn404()
    {
        var (nextCalled, result) = await RunAsync(Active, Expired, collectionOwner: null);
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task APublicLinkWrite_IsGatedOnTheLinksOwner()
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Method = "POST";
        httpContext.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity("test"));
        var context = new ActionExecutingContext(
            new ActionContext(httpContext, new RouteData(), new ActionDescriptor { EndpointMetadata = [new CollectionOwnedWriteAttribute { PublicIdRoute = "publicId" }] }),
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());
        context.RouteData.Values["publicId"] = "AbCdEf";

        var nextCalled = false;
        await new RequireWriteAccessFilter(
            new BillingOptions { ProgramEnabled = true, ProgramStartAtUtc = DateTimeOffset.UnixEpoch },
            new Identity(),
            new Entitlements(Active, Expired),
            new Users(),
            new Owners(collectionOwner: null, publicOwner: OwnerId)).OnActionExecutionAsync(
            context,
            () =>
            {
                nextCalled = true;
                return Task.FromResult(new ActionExecutedContext(context, context.Filters, context.Controller));
            });

        Assert.False(nextCalled);
        Assert.Equal("collectionOwnerSubscriptionRequired", CodeOf(context.Result));
    }

    private sealed record UndoRequest(Guid UndoOperationId);

    [Fact]
    public async Task AcceptingAnInvitation_ActiveActor_ActiveOwner_IsAllowed()
    {
        var (nextCalled, result) = await RunAsync(
            Active, Active, null, invitationOwner: OwnerId,
            metadata: [new CollectionOwnedWriteAttribute { InvitationIdRoute = "invitationId" }],
            configure: context => context.RouteData.Values["invitationId"] = "7");
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task AcceptingAnInvitation_ActiveActor_ExpiredOwner_IsBlocked_WithTheOwnerCode()
    {
        var (nextCalled, result) = await RunAsync(
            Active, Expired, null, invitationOwner: OwnerId,
            metadata: [new CollectionOwnedWriteAttribute { InvitationIdRoute = "invitationId" }],
            configure: context => context.RouteData.Values["invitationId"] = "7");
        Assert.False(nextCalled);
        Assert.Equal("collectionOwnerSubscriptionRequired", CodeOf(result));
    }

    [Fact]
    public async Task AcceptingAnInvitation_ExpiredActor_IsBlocked_WithTheActorCode()
    {
        var (nextCalled, result) = await RunAsync(
            Expired, Active, null, invitationOwner: OwnerId,
            metadata: [new CollectionOwnedWriteAttribute { InvitationIdRoute = "invitationId" }],
            configure: context => context.RouteData.Values["invitationId"] = "7");
        Assert.False(nextCalled);
        Assert.Equal("subscriptionRequired", CodeOf(result));
    }

    [Fact]
    public async Task DecliningAnInvitation_StaysAllowed_EvenIfOwnerAndActorAreExpired()
    {
        var (nextCalled, result) = await RunAsync(
            Expired, Expired, null, invitationOwner: OwnerId,
            metadata: [new CollectionOwnedWriteAttribute { InvitationIdRoute = "invitationId" }, new AllowWhenSubscriptionExpiredAttribute()],
            configure: context => context.RouteData.Values["invitationId"] = "7");
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task AnUnknownInvitation_IsLeftToTheActionsOwn404()
    {
        var (nextCalled, result) = await RunAsync(
            Active, Expired, null, invitationOwner: null,
            metadata: [new CollectionOwnedWriteAttribute { InvitationIdRoute = "invitationId" }],
            configure: context => context.RouteData.Values["invitationId"] = "7");
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task UndoingAMerge_IsGatedOnTheOwnersOfTheCollectionsThatMergeTouched()
    {
        var (nextCalled, result) = await RunAsync(
            Active, Expired, null, mergeOwners: [OwnerId],
            metadata: [new CollectionOwnedWriteAttribute { MergeOperationProperty = "UndoOperationId" }],
            configure: context => context.ActionArguments["request"] = new UndoRequest(Guid.NewGuid()));
        Assert.False(nextCalled);
        Assert.Equal("collectionOwnerSubscriptionRequired", CodeOf(result));
    }

    [Fact]
    public async Task UndoingAMerge_OnTheActorsOwnCollections_NeedsOnlyTheActorCheck()
    {
        // A merge only ever runs on the caller's own Collections: source and target resolve to the actor - checked once, not twice.
        var (nextCalled, result) = await RunAsync(
            Active, Expired, null, mergeOwners: [ActorId],
            metadata: [new CollectionOwnedWriteAttribute { MergeOperationProperty = "UndoOperationId" }],
            configure: context => context.ActionArguments["request"] = new UndoRequest(Guid.NewGuid()));
        Assert.True(nextCalled);
        Assert.Null(result);
    }

    [Fact]
    public async Task UndoingAMerge_ByAnExpiredActor_IsBlocked()
    {
        var (nextCalled, result) = await RunAsync(
            Expired, Active, null, mergeOwners: [ActorId],
            metadata: [new CollectionOwnedWriteAttribute { MergeOperationProperty = "UndoOperationId" }],
            configure: context => context.ActionArguments["request"] = new UndoRequest(Guid.NewGuid()));
        Assert.False(nextCalled);
        Assert.Equal("subscriptionRequired", CodeOf(result));
    }

    [Fact]
    public async Task AMethodLevelDeclaration_WinsOverTheControllersOwn()
    {
        // Controller-level metadata comes first, the action's last: the action's own description of where its Collection comes from is used.
        var (nextCalled, result) = await RunAsync(
            Active, Expired, null, invitationOwner: OwnerId,
            metadata: [new CollectionOwnedWriteAttribute { RouteIds = ["id"] }, new CollectionOwnedWriteAttribute { InvitationIdRoute = "invitationId" }],
            configure: context => context.RouteData.Values["invitationId"] = "7");
        Assert.False(nextCalled);
        Assert.Equal("collectionOwnerSubscriptionRequired", CodeOf(result));
    }

    [Fact]
    public void AcceptInvitation_AndUndoMerge_AreOwnerGated_NotJustActorGated()
    {
        var accept = typeof(CollectionInvitationsController).GetMethods()
            .Single(method => method.GetCustomAttributes<HttpMethodAttribute>().Any(http => http.Template == "collection-invitations/{invitationId:long}/accept"));
        var undo = typeof(CollectionsController).GetMethods()
            .Single(method => method.GetCustomAttributes<HttpMethodAttribute>().Any(http => http.Template == "merge/undo"));

        Assert.Equal("invitationId", accept.GetCustomAttribute<CollectionOwnedWriteAttribute>()!.InvitationIdRoute);
        Assert.Equal("UndoOperationId", undo.GetCustomAttribute<CollectionOwnedWriteAttribute>()!.MergeOperationProperty);
        Assert.Null(accept.GetCustomAttribute<AllowWhenSubscriptionExpiredAttribute>());
        Assert.Null(undo.GetCustomAttribute<AllowWhenSubscriptionExpiredAttribute>());
    }
}

public sealed class BootstrapEntitlementContractTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 5, 0, 0, 0, TimeSpan.Zero);

    private static JsonElement Json(Entitlement entitlement) => JsonSerializer.SerializeToElement(
        CurrentUserBootstrapController.EntitlementResponse.From(entitlement), new JsonSerializerOptions(JsonSerializerDefaults.Web));

    [Fact]
    public void ProgramNotLaunched_HasNoStatus_AndCanWrite()
    {
        var json = Json(Entitlement.NotLaunched(Now));

        Assert.False(json.GetProperty("programEnabled").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("status").ValueKind);
        Assert.Equal(JsonValueKind.Null, json.GetProperty("reason").ValueKind);
        Assert.True(json.GetProperty("canWrite").GetBoolean());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("accessFrozenAtUtc").ValueKind);
        Assert.Equal(Now, json.GetProperty("verifiedAtUtc").GetDateTimeOffset());
    }

    [Fact]
    public void ATrial_IsSerializedAsTheDocumentedShape()
    {
        var window = new TrialWindow(Now.AddDays(-1), Now.AddDays(29));

        var json = Json(Entitlement.ForTrial(window, Now));

        Assert.True(json.GetProperty("programEnabled").GetBoolean());
        Assert.Equal("trial", json.GetProperty("status").GetString());
        Assert.Equal("none", json.GetProperty("reason").GetString());
        Assert.Equal(window.StartedAtUtc, json.GetProperty("trialStartedAtUtc").GetDateTimeOffset());
        Assert.Equal(window.EndsAtUtc, json.GetProperty("trialEndsAtUtc").GetDateTimeOffset());
        Assert.Equal(JsonValueKind.Null, json.GetProperty("currentPeriodEndsAtUtc").ValueKind);
        Assert.True(json.GetProperty("canWrite").GetBoolean());
    }

    [Fact]
    public void AnExpiredTrial_CannotWrite_AndCarriesTheFreezeInstant()
    {
        var window = new TrialWindow(Now.AddDays(-40), Now.AddDays(-10));

        var json = Json(Entitlement.ForTrial(window, Now));

        Assert.Equal("expired", json.GetProperty("status").GetString());
        Assert.False(json.GetProperty("canWrite").GetBoolean());
        Assert.Equal(window.EndsAtUtc, json.GetProperty("accessFrozenAtUtc").GetDateTimeOffset());
    }

    [Theory]
    [InlineData(EntitlementStatus.Active, "active")]
    [InlineData(EntitlementStatus.GracePeriod, "gracePeriod")]
    public void PaidStates_UseTheDocumentedWireNames(EntitlementStatus status, string wire)
    {
        var json = Json(Entitlement.Paid(status, Now.AddDays(20), EntitlementReason.BillingIssue, null, Now));

        Assert.Equal(wire, json.GetProperty("status").GetString());
        Assert.Equal("billingIssue", json.GetProperty("reason").GetString());
        Assert.True(json.GetProperty("canWrite").GetBoolean());
    }

    [Fact]
    public void TheContractExposesOnlyTheDocumentedFields_NoIdentityHashNoIdsNoTokens()
    {
        var json = Json(Entitlement.ForTrial(new TrialWindow(Now.AddDays(-1), Now.AddDays(29)), Now));

        var names = json.EnumerateObject().Select(property => property.Name).Order().ToArray();

        Assert.Equal(
            ["accessFrozenAtUtc", "canWrite", "currentPeriodEndsAtUtc", "programEnabled", "reason", "status", "trialEndsAtUtc", "trialStartedAtUtc", "verifiedAtUtc"],
            names);
    }
}
