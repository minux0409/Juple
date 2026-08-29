using Juple.Application.Identity;
using Microsoft.Identity.Web;

namespace Juple.Api.Authentication;

public sealed class HttpContextExternalIdentityAccessor(IHttpContextAccessor httpContextAccessor)
    : IExternalIdentityAccessor
{
    public ExternalIdentityPrincipal GetRequired()
    {
        var principal = httpContextAccessor.HttpContext?.User;
        var tenantId = principal?.GetTenantId();
        var objectId = principal?.GetObjectId();

        if (!Guid.TryParse(tenantId, out var parsedTenantId)
            || !Guid.TryParse(objectId, out var parsedObjectId))
        {
            throw new UnauthorizedAccessException("The authenticated identity is missing a valid tenant or object ID.");
        }

        return new ExternalIdentityPrincipal(parsedTenantId, parsedObjectId);
    }
}