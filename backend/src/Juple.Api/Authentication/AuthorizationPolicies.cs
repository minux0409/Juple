using Microsoft.AspNetCore.Authorization;
using Microsoft.Identity.Web;

namespace Juple.Api.Authentication;

public static class AuthorizationPolicies
{
    public const string JupleUser = "JupleUser";

    /// <summary>
    /// The Admin Web's API (api/v1/admin): everything JupleUser requires, plus an ACTIVE grant in admin.AdminUsers for the internal
    /// user the token maps to (ActiveAdminAuthorizationHandler).
    /// </summary>
    public const string JupleAdmin = "JupleAdmin";

    /// <summary>The checks every signed-in Juple request needs: an authenticated principal, the API scope, a tenant and an object id.</summary>
    public static void RequireJupleIdentity(AuthorizationPolicyBuilder policy, string requiredScope)
    {
        policy.RequireAuthenticatedUser();
        policy.RequireScope(requiredScope);
        policy.RequireAssertion(context =>
            Guid.TryParse(context.User.GetTenantId(), out _)
            && Guid.TryParse(context.User.GetObjectId(), out _));
    }

    /// <summary>Registers both policies; the Admin one is JupleUser plus the active-admin requirement.</summary>
    public static AuthorizationBuilder AddJuplePolicies(this AuthorizationBuilder builder, string requiredScope) =>
        builder
            .AddPolicy(JupleUser, policy => RequireJupleIdentity(policy, requiredScope))
            .AddPolicy(JupleAdmin, policy =>
            {
                RequireJupleIdentity(policy, requiredScope);
                policy.AddRequirements(new ActiveAdminRequirement());
            });
}
