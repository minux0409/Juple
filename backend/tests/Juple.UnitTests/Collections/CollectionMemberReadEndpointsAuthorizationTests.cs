using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Controllers;
using Juple.Application.Collections.Access;
using Microsoft.AspNetCore.Authorization;

namespace Juple.UnitTests.Collections;

/// <summary>
/// The member-readable Collection reads (participants, the public link to pass on) are for signed-in
/// Juple users only - never anonymous visitors of the public link page - and stay reads: they carry
/// no Owner-only permission filter, while the share settings themselves still require ManageShare.
/// </summary>
public sealed class CollectionMemberReadEndpointsAuthorizationTests
{
    [Theory]
    [InlineData(nameof(CollectionsController.GetParticipantsAsync))]
    [InlineData(nameof(CollectionsController.GetShareLinkAsync))]
    public void MemberReads_RequireASignedInJupleUser_AndAreNeverAnonymous(string actionName)
    {
        var controllerPolicy = typeof(CollectionsController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal(AuthorizationPolicies.JupleUser, controllerPolicy?.Policy);

        var action = typeof(CollectionsController).GetMethod(actionName)!;
        Assert.Null(action.GetCustomAttribute<AllowAnonymousAttribute>());
        // Not gated to the Owner: access is checked inside as View (owner or accepted member).
        Assert.Null(action.GetCustomAttribute<CollectionPermissionAttribute>());
    }

    [Fact]
    public void TheOwnersShareSettings_StillRequireManageShare()
    {
        var getShare = typeof(CollectionsController).GetMethod(nameof(CollectionsController.GetShareAsync))!;
        var filter = getShare.GetCustomAttribute<CollectionPermissionAttribute>();
        Assert.NotNull(filter);
        Assert.Equal(CollectionPermission.ManageShare, filter!.Arguments![0]);
    }

    [Fact]
    public void TheMembersShareLinkResponse_CarriesOnlyOnOffAndTheUrl()
    {
        Assert.Equal(
            ["IsShared", "ShareUrl"],
            typeof(CollectionsController.CollectionShareLinkResponse).GetProperties().Select(property => property.Name).Order());
    }
}
