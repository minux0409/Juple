using Juple.Application.Admin;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Identity.Web;

namespace Juple.Api.Authentication;

/// <summary>
/// The Admin policy's own requirement: the authenticated principal maps to an internal Juple user (ExternalIdentity -> Users, the
/// same lookup every request uses) AND that user holds an ACTIVE grant in admin.AdminUsers. Nothing the client sends - no header,
/// claim of our own, body field or route value - takes part in the decision; a valid token of a non-admin is simply not enough
/// (403), and a missing/invalid token never reaches this handler (401 from the JWT scheme).
/// </summary>
public sealed class ActiveAdminRequirement : IAuthorizationRequirement;

public sealed class ActiveAdminAuthorizationHandler(
    ICurrentJupleUserAccessor currentUserAccessor,
    IAdminAccessStore adminAccessStore,
    IHttpContextAccessor httpContextAccessor) : AuthorizationHandler<ActiveAdminRequirement>
{
    protected override async Task HandleRequirementAsync(AuthorizationHandlerContext context, ActiveAdminRequirement requirement)
    {
        if (!Guid.TryParse(context.User.GetTenantId(), out var tenantId) || !Guid.TryParse(context.User.GetObjectId(), out var objectId))
        {
            return;
        }

        CurrentJupleUser user;
        try
        {
            user = await currentUserAccessor.GetRequiredAsync(new ExternalIdentityPrincipal(tenantId, objectId));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            // Signed in with Entra but no Juple account: certainly not an admin.
            return;
        }

        var access = await adminAccessStore.FindActiveAsync(user.UserId);
        if (access is null)
        {
            return;
        }

        if (httpContextAccessor.HttpContext is { } httpContext)
        {
            AdminRequestContext.Set(httpContext, access);
        }

        context.Succeed(requirement);
    }
}

/// <summary>The admin the Admin policy authorized for THIS request - the only source of the acting admin's identity.</summary>
public static class AdminRequestContext
{
    private static readonly object Key = new();

    public static void Set(HttpContext httpContext, AdminAccess access) => httpContext.Items[Key] = access;

    /// <summary>Throws when the request did not pass the Admin policy (a programming error: every admin action carries it).</summary>
    public static AdminAccess GetRequired(HttpContext httpContext) =>
        httpContext.Items.TryGetValue(Key, out var value) && value is AdminAccess access
            ? access
            : throw new InvalidOperationException("The request was not authorized by the Admin policy.");
}
