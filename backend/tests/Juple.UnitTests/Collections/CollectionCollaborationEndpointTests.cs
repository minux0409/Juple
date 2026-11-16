using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Api.Controllers;
using System.Security.Claims;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Locking;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.UnitTests.Collections;

/// <summary>
/// Every Owner-only Collection endpoint declares its permission (so a Contributor gets 403, not a
/// silent success or a misleading 404), member endpoints do not, and the new person-to-person and
/// unlock endpoints carry authentication and rate limiting.
/// </summary>
public sealed class CollectionCollaborationEndpointTests
{
    private static MethodInfo Action(Type controller, string name) =>
        controller.GetMethod(name) ?? throw new InvalidOperationException($"{controller.Name}.{name} not found");

    private static CollectionPermission? DeclaredPermission(MethodInfo action) =>
        action.GetCustomAttribute<CollectionPermissionAttribute>() is { } attribute
            ? (CollectionPermission)attribute.Arguments![0]!
            : null;

    [Theory]
    [InlineData("RenameAsync", CollectionPermission.Edit)]
    [InlineData("SetFavoriteAsync", CollectionPermission.Favorite)]
    [InlineData("SetIconAsync", CollectionPermission.Edit)]
    [InlineData("SetColorAsync", CollectionPermission.Edit)]
    [InlineData("DeleteAsync", CollectionPermission.Delete)]
    [InlineData("EnableShareAsync", CollectionPermission.ManageShare)]
    [InlineData("GetShareAsync", CollectionPermission.ManageShare)]
    [InlineData("RevokeShareAsync", CollectionPermission.ManageShare)]
    [InlineData("MoveItemAsync", CollectionPermission.Reorganize)]
    [InlineData("TransferItemAsync", CollectionPermission.Reorganize)]
    [InlineData("UndoTransferItemAsync", CollectionPermission.Reorganize)]
    [InlineData("MergeAsync", CollectionPermission.Reorganize)]
    public void OwnerOnlyEndpoints_DeclareTheirPermission(string actionName, CollectionPermission expected)
    {
        Assert.Equal(expected, DeclaredPermission(Action(typeof(CollectionsController), actionName)));
    }

    /// <summary>
    /// 컬렉션에서 제거 is open to every member at the endpoint (View); the service decides - the Owner
    /// any link, a member only their own (see RemoveItemFromCollectionService).
    /// </summary>
    [Fact]
    public void RemovingALink_IsCheckedPerLinkByTheService()
    {
        Assert.Equal(CollectionPermission.View, DeclaredPermission(Action(typeof(CollectionsController), "RemoveItemAsync")));
    }

    /// <summary>
    /// Every sharing-management action of the unified Share screen needs the Owner's permission AND,
    /// on a locked Collection, the same unlock grant as its content.
    /// </summary>
    [Theory]
    [InlineData("EnableShareAsync", CollectionPermission.ManageShare)]
    [InlineData("RevokeShareAsync", CollectionPermission.ManageShare)]
    [InlineData("InviteAsync", CollectionPermission.ManageCollaborators)]
    [InlineData("RevokeInvitationAsync", CollectionPermission.ManageCollaborators)]
    [InlineData("ChangeInvitationRoleAsync", CollectionPermission.ManageCollaborators)]
    [InlineData("ChangeCollaboratorRoleAsync", CollectionPermission.ManageCollaborators)]
    [InlineData("RemoveCollaboratorAsync", CollectionPermission.ManageCollaborators)]
    public void ShareManagementEndpoints_AreOwnerOnly_AndNeedTheUnlockGrant(string actionName, CollectionPermission expected)
    {
        var attribute = Action(typeof(CollectionsController), actionName).GetCustomAttribute<CollectionPermissionAttribute>();
        Assert.NotNull(attribute);
        Assert.Equal(expected, (CollectionPermission)attribute.Arguments![0]!);
        Assert.True((bool)attribute.Arguments[2]!);
    }

    [Fact]
    public void RoleChangeEndpoints_AddressPeopleByJupleIdAndInvitationsById()
    {
        Assert.Equal("{id:long}/collaborators/{jupleId}/role",
            Action(typeof(CollectionsController), "ChangeCollaboratorRoleAsync").GetCustomAttribute<HttpPutAttribute>()?.Template);
        Assert.Equal("{id:long}/invitations/{invitationId:long}/role",
            Action(typeof(CollectionsController), "ChangeInvitationRoleAsync").GetCustomAttribute<HttpPutAttribute>()?.Template);
    }

    [Fact]
    public async Task AnOlderClientSendingAPerCollectionPassword_IsRefused_NotLockedWithADifferentPassword()
    {
        var controller = (CollectionsController)typeof(CollectionsController).GetConstructors()[0]
            .Invoke(new object?[typeof(CollectionsController).GetConstructors()[0].GetParameters().Length]);

        foreach (var request in new[]
        {
            new CollectionsController.SetCollectionLockRequest("typed-per-collection", null),
            new CollectionsController.SetCollectionLockRequest("new-one-1", "old-one-1"),
        })
        {
            var problem = Assert.IsType<ObjectResult>(await controller.SetLockAsync(1, request, null!, CancellationToken.None));
            Assert.Equal(409, problem.StatusCode);
            Assert.Equal(CollectionProblems.LockUsesAccountPassword, ((ProblemDetails)problem.Value!).Extensions["code"]);
        }
    }

    [Fact]
    public async Task Reset_TakesTheSignInTimeOnlyFromTheValidatedToken()
    {
        var service = new RecordingLockPasswordService();
        var signedInAt = DateTimeOffset.UtcNow.AddSeconds(-30);
        var controller = SettingsController(service, new Claim("auth_time", signedInAt.ToUnixTimeSeconds().ToString()));

        Assert.IsType<NoContentResult>(await controller.ResetAsync(
            new CollectionLockSettingsController.ResetCollectionLockPasswordRequest("new-pass-1", "new-pass-1"), CancellationToken.None));
        Assert.Equal(signedInAt.ToUnixTimeSeconds(), service.AuthenticatedAtUtc!.Value.ToUnixTimeSeconds());
        Assert.Equal(7, service.UserId);
    }

    [Fact]
    public async Task Reset_WithoutARecentSignIn_Is403RecentAuthenticationRequired()
    {
        var locks = new InMemoryCollectionLockStore();
        var service = new CollectionLockPasswordService(
            new InMemoryCollectionLockSettingsStore(locks), new FakePasswordHasher(), TimeProvider.System);

        foreach (var claims in new[]
        {
            Array.Empty<Claim>(),
            [new Claim("auth_time", DateTimeOffset.UtcNow.AddMinutes(-6).ToUnixTimeSeconds().ToString())],
            [new Claim("iat", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString())],
        })
        {
            var problem = Assert.IsType<ObjectResult>(await SettingsController(service, claims).ResetAsync(
                new CollectionLockSettingsController.ResetCollectionLockPasswordRequest("new-pass-1", "new-pass-1"), CancellationToken.None));
            Assert.Equal(403, problem.StatusCode);
            Assert.Equal(CollectionProblems.RecentAuthenticationRequiredCode, ((ProblemDetails)problem.Value!).Extensions["code"]);
        }
    }

    [Fact]
    public async Task Change_WithoutALockPassword_Is409NotConfigured()
    {
        var service = new CollectionLockPasswordService(
            new InMemoryCollectionLockSettingsStore(new InMemoryCollectionLockStore()), new FakePasswordHasher(), TimeProvider.System);

        var problem = Assert.IsType<ObjectResult>(await SettingsController(service).ChangeAsync(
            new CollectionLockSettingsController.ChangeCollectionLockPasswordRequest("current-1", "new-pass-1", "new-pass-1"),
            CancellationToken.None));
        Assert.Equal(409, problem.StatusCode);
        Assert.Equal(CollectionProblems.LockPasswordNotConfiguredCode, ((ProblemDetails)problem.Value!).Extensions["code"]);
    }

    [Fact]
    public void LockPasswordReset_IsAPostOnTheCurrentUsersOwnSetting()
    {
        Assert.Equal("reset", Action(typeof(CollectionLockSettingsController), "ResetAsync").GetCustomAttribute<HttpPostAttribute>()?.Template);
        Assert.NotNull(Action(typeof(CollectionLockSettingsController), "ChangeAsync").GetCustomAttribute<HttpPutAttribute>());
    }

    private static CollectionLockSettingsController SettingsController(ICollectionLockPasswordService service, params Claim[] claims) =>
        new(new FixedIdentity(), new FixedUser(7), service, TimeProvider.System)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer")) },
            },
        };

    private sealed class FixedIdentity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class FixedUser(long userId) : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CurrentJupleUser(userId, "UTC", UserPlan.Free));
    }

    private sealed class RecordingLockPasswordService : ICollectionLockPasswordService
    {
        public long UserId { get; private set; }

        public DateTimeOffset? AuthenticatedAtUtc { get; private set; }

        public Task<CollectionLockPasswordStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CollectionLockPasswordStatusDto(false, null));

        public Task ChangeAsync(long userId, string? currentPassword, string? newPassword, string? confirmPassword, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task ResetAsync(long userId, string? newPassword, string? confirmPassword, DateTimeOffset? authenticatedAtUtc, CancellationToken cancellationToken = default)
        {
            UserId = userId;
            AuthenticatedAtUtc = authenticatedAtUtc;
            return Task.CompletedTask;
        }
    }

    [Fact]
    public void LockPasswordSettings_StillRequireAJupleUser()
    {
        Assert.Equal(AuthorizationPolicies.JupleUser, typeof(CollectionLockSettingsController).GetCustomAttribute<AuthorizeAttribute>()?.Policy);
        Assert.Equal("api/v1/users/me/collection-lock", typeof(CollectionLockSettingsController).GetCustomAttribute<RouteAttribute>()?.Template);
    }

    [Theory]
    [InlineData("GetAsync")]
    [InlineData("GetItemsAsync")]
    [InlineData("GetSharedItemAsync")]
    [InlineData("AddItemAsync")]
    public void MemberEndpoints_AreNotOwnerGated_TheirServicesCheckAccess(string actionName)
    {
        Assert.Null(DeclaredPermission(Action(typeof(CollectionsController), actionName)));
    }

    [Fact]
    public void PersonToPersonEndpoints_RequireAJupleUser_AndLookupIsRateLimited()
    {
        var authorize = typeof(CollectionInvitationsController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal(AuthorizationPolicies.JupleUser, authorize?.Policy);

        foreach (var action in new[] { "LookupAsync" })
        {
            Assert.Equal(RateLimitPolicies.JupleIdLookup,
                Action(typeof(CollectionInvitationsController), action).GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        }

        // Invitations have their own per-identity bucket, separate from Juple ID lookups.
        Assert.Equal(RateLimitPolicies.CollectionInvite,
            Action(typeof(CollectionsController), "InviteAsync").GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        Assert.Equal("collection-invitations/{invitationId:long}/accept",
            Action(typeof(CollectionInvitationsController), "AcceptAsync").GetCustomAttribute<HttpPostAttribute>()?.Template);
    }

    [Theory]
    [InlineData(typeof(CollectionsController), "UnlockAsync", RateLimitPolicies.CollectionUnlock)]
    [InlineData(typeof(CollectionsController), "SetLockAsync", RateLimitPolicies.CollectionUnlock)]
    [InlineData(typeof(CollectionsController), "RemoveLockAsync", RateLimitPolicies.CollectionUnlock)]
    [InlineData(typeof(CollectionLockSettingsController), "ChangeAsync", RateLimitPolicies.CollectionLockPassword)]
    [InlineData(typeof(CollectionLockSettingsController), "ResetAsync", RateLimitPolicies.CollectionLockPassword)]
    [InlineData(typeof(PublicCollectionsController), "UnlockAsync", RateLimitPolicies.PublicCollectionUnlock)]
    public void PasswordEndpoints_AreRateLimited(Type controller, string actionName, string policy)
    {
        Assert.Equal(policy, Action(controller, actionName).GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
    }

    [Fact]
    public void CollectionsController_StillRequiresAJupleUser_AndPublicControllerStaysAnonymous()
    {
        Assert.Equal(AuthorizationPolicies.JupleUser, typeof(CollectionsController).GetCustomAttribute<AuthorizeAttribute>()?.Policy);
        Assert.Null(typeof(PublicCollectionsController).GetCustomAttribute<AuthorizeAttribute>());
    }
}
