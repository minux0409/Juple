using Microsoft.Identity.Web;

namespace Juple.Api.Configuration;

public static class RateLimitPolicies
{
    public const string JupleIdLookup = "juple-id-lookup";
    public const string CollectionUnlock = "collection-unlock";
    public const string PublicCollectionUnlock = "public-collection-unlock";
    public const string PublicCollectionWrite = "public-collection-write";
    public const string CollectionLockPassword = "collection-lock-password";
    public const string CollectionInvite = "collection-invite";
    public const string SupportInquiryCreate = "support-inquiry-create";

    /// <summary>Google Play billing catalog / verify / restore: per signed-in identity (the public RTDN webhook has none, on purpose).</summary>
    public const string BillingGoogle = "billing-google";

    /// <summary>Public unlock: the share link plus the opaque browser attempt id (bounded length; never logged).</summary>
    public static string PublicUnlockPartitionKey(HttpContext httpContext)
    {
        var publicId = httpContext.Request.RouteValues["publicId"]?.ToString() ?? string.Empty;
        var attemptId = httpContext.Request.Headers["X-Juple-Unlock-Attempt"].ToString();
        if (attemptId.Length is 0 or > 64)
        {
            attemptId = "anon";
        }

        return $"public-unlock:{publicId}:{attemptId}";
    }

    /// <summary>
    /// The signed-in identity (tenant + object id - the same pair the JupleUser policy requires),
    /// falling back to the remote address for a request that somehow has none. Never logged.
    /// </summary>
    public static string IdentityPartitionKey(HttpContext httpContext)
    {
        var tenantId = httpContext.User.GetTenantId();
        var objectId = httpContext.User.GetObjectId();
        return !string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(objectId)
            ? $"id:{tenantId}:{objectId}"
            : $"ip:{httpContext.Connection.RemoteIpAddress}";
    }
}
