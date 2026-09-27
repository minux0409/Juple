using System.Reflection;
using Juple.Api.Collections;
using Juple.Api.Controllers;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Locking;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;

namespace Juple.UnitTests.Collections;

/// <summary>
/// The lock protects managing a Collection too - rename/icon/color/delete, public share and
/// collaboration management need a valid unlock grant when the Collection is locked, for the Owner
/// as much as anyone - enforced centrally by CollectionPermissionFilter, never per controller.
/// </summary>
public sealed class CollectionManagementLockTests
{
    private const long Owner = 1;
    private const long Contributor = 2;
    private const long Stranger = 3;
    private const long Locked = 10;
    private const long Unlocked = 11;

    private static bool RequiresUnlock(string actionName) =>
        (bool)(typeof(CollectionsController).GetMethod(actionName)!
            .GetCustomAttribute<CollectionPermissionAttribute>()?.Arguments![2] ?? false);

    [Theory]
    [InlineData("RenameAsync")]
    [InlineData("SetIconAsync")]
    [InlineData("SetColorAsync")]
    [InlineData("DeleteAsync")]
    [InlineData("EnableShareAsync")]
    [InlineData("RevokeShareAsync")]
    [InlineData("InviteAsync")]
    [InlineData("RevokeInvitationAsync")]
    [InlineData("RemoveCollaboratorAsync")]
    public void ManagementEndpoints_RequireAnUnlockGrant(string actionName) =>
        Assert.True(RequiresUnlock(actionName));

    [Theory]
    [InlineData("SetFavoriteAsync")] // a personal mark, not a change to the Collection
    [InlineData("GetShareAsync")]
    public void PersonalAndReadOnlyEndpoints_DoNotRequireUnlock(string actionName) =>
        Assert.False(RequiresUnlock(actionName));

    [Fact]
    public async Task LockedCollection_OwnerManagementWithoutGrant_Is403CollectionLocked()
    {
        var result = await RunFilterAsync(Owner, Locked, CollectionPermission.Edit, unlockToken: null);

        var problem = Assert.IsType<ObjectResult>(result);
        Assert.Equal(StatusCodes.Status403Forbidden, problem.StatusCode);
        Assert.Equal("collectionLocked", ((ProblemDetails)problem.Value!).Extensions["code"]);
    }

    [Theory]
    [InlineData(CollectionPermission.Edit)]
    [InlineData(CollectionPermission.Delete)]
    [InlineData(CollectionPermission.ManageShare)]
    [InlineData(CollectionPermission.ManageCollaborators)]
    public async Task LockedCollection_OwnerWithAValidGrant_Proceeds(CollectionPermission permission)
    {
        var grant = FakeUnlockTokenProtector.Token(Locked, CollectionUnlockSubject.ForUser(Owner), 4);

        Assert.Null(await RunFilterAsync(Owner, Locked, permission, grant));
    }

    [Fact]
    public async Task ContributorWithAValidGrant_IsStill403ForAnOwnerOnlyAction()
    {
        var grant = FakeUnlockTokenProtector.Token(Locked, CollectionUnlockSubject.ForUser(Contributor), 4);

        var result = await RunFilterAsync(Contributor, Locked, CollectionPermission.ManageShare, grant);

        var problem = Assert.IsType<ObjectResult>(result);
        Assert.Equal("collectionForbidden", ((ProblemDetails)problem.Value!).Extensions["code"]);
    }

    [Fact]
    public async Task NoMembership_Is404_WithOrWithoutAGrant()
    {
        var grant = FakeUnlockTokenProtector.Token(Locked, CollectionUnlockSubject.ForUser(Stranger), 4);

        Assert.IsType<NotFoundResult>(await RunFilterAsync(Stranger, Locked, CollectionPermission.Edit, grant));
    }

    [Fact]
    public async Task AnUnlockedCollection_IsManagedWithoutAnyGrant()
    {
        Assert.Null(await RunFilterAsync(Owner, Unlocked, CollectionPermission.Delete, unlockToken: null));
    }

    /// <summary>Runs the filter with requireUnlock; returns its short-circuit result, or null when it let the action run.</summary>
    private static async Task<IActionResult?> RunFilterAsync(long userId, long collectionId, CollectionPermission permission, string? unlockToken)
    {
        var accessStore = new InMemoryCollectionAccessStore().Add(Locked, Owner, Contributor).Add(Unlocked, Owner, Contributor);
        accessStore.SetLock(Locked, isLocked: true, lockVersion: 4);
        var access = new CollectionAccessService(accessStore, new FakeUnlockTokenProtector(), TimeProvider.System);
        var filter = new CollectionPermissionFilter(permission, "id", true, new FixedIdentity(), new FixedUser(userId), access);

        var httpContext = new DefaultHttpContext();
        if (unlockToken is not null)
        {
            httpContext.Request.Headers[CollectionsController.UnlockTokenHeader] = unlockToken;
        }

        var routeData = new RouteData();
        routeData.Values["id"] = collectionId.ToString();
        var context = new ActionExecutingContext(
            new ActionContext(httpContext, routeData, new ActionDescriptor()),
            [],
            new Dictionary<string, object?>(),
            controller: new object());

        var ran = false;
        await filter.OnActionExecutionAsync(context, () =>
        {
            ran = true;
            return Task.FromResult(new ActionExecutedContext(context, [], new object()));
        });
        return ran ? null : context.Result;
    }

    private sealed class FixedIdentity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class FixedUser(long userId) : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CurrentJupleUser(userId, "UTC", UserPlan.Free));
    }
}
