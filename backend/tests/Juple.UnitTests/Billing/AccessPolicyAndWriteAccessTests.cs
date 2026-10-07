using System.Reflection;
using System.Text.Json;
using Juple.Api.Billing;
using Juple.Api.Controllers;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Billing;
using Juple.Domain.Collections;
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

    private sealed class FixedEntitlements(Entitlement? entitlement, bool notBootstrapped = false) : IEntitlementService
    {
        public int Reads { get; private set; }

        public Task<Entitlement> GetForUserAsync(long userId, CancellationToken cancellationToken = default) => Read();

        public Task<Entitlement> GetForIdentityAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) => Read();

        private Task<Entitlement> Read()
        {
            Reads++;
            return notBootstrapped ? throw new CurrentJupleUserNotFoundException() : Task.FromResult(entitlement!);
        }
    }

    private static ActionExecutingContext Context(params object[] endpointMetadata)
    {
        var descriptor = new ActionDescriptor { EndpointMetadata = endpointMetadata };
        return new ActionExecutingContext(
            new ActionContext(new DefaultHttpContext(), new RouteData(), descriptor),
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            controller: new object());
    }

    private static async Task<(bool NextCalled, IActionResult? Result)> RunAsync(BillingOptions options, FixedEntitlements entitlements, ActionExecutingContext context)
    {
        var nextCalled = false;
        await new RequireWriteAccessFilter(options, new FixedIdentity(), entitlements).OnActionExecutionAsync(
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

    [Fact]
    public void TheEndpointsThatStayUsableWhenExpired_AreExactlyTheseControllers()
    {
        var allowed = Controllers()
            .Where(type => type.GetCustomAttribute<AllowWhenSubscriptionExpiredAttribute>() is not null)
            .Select(type => type.Name)
            .Order()
            .ToArray();

        // account deletion, support inquiries, the bootstrap/session plumbing and push-device registration.
        // Billing verify / restore / manage controllers join this list in R39-B/C.
        Assert.Equal(
            ["AccountController", "AuthSessionController", "CurrentUserBootstrapController", "GoogleBillingController", "PushDevicesController", "SupportInquiriesController"],
            allowed);
    }

    [Fact]
    public void EnforcementIsNotAppliedToAnyEndpointYet()
    {
        var gated = Controllers()
            .SelectMany(type => type.GetCustomAttributes<RequireWriteAccessAttribute>().Select(_ => type.Name)
                .Concat(type.GetMethods().Where(method => method.GetCustomAttribute<RequireWriteAccessAttribute>() is not null).Select(method => $"{type.Name}.{method.Name}")))
            .ToArray();

        // R39-D (after the stores are proven) is what applies it to content writes - add, edit, delete, restore, Collection and
        // item mutations, sharing, invitations, collaborators, reactions, comments, friends, image uploads, copy/import and
        // public-share writes into an expired owner's Collection. Until then this must stay empty.
        Assert.Empty(gated);
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
