using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;
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
    public const string ReportCreate = "report-create";
    public const string BlockChange = "block-change";
    public const string DataExport = "data-export";
    public const string DataExportDownload = "data-export-download";
    public const string ExpenseFiles = "admin-expense-files";

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
        if (httpContext.User.Identity?.IsAuthenticated == true
            && Guid.TryParse(tenantId, out var tenant) && Guid.TryParse(objectId, out var subject))
            return $"id:{tenant:D}:{subject:D}";

        // Forwarded headers are not trusted here. An ingress may present a shared socket address;
        // anonymous IP admission stays OFF until its proxy trust boundary is verified.
        var address = httpContext.Connection.RemoteIpAddress;
        if (address?.IsIPv4MappedToIPv6 == true) address = address.MapToIPv4();
        if (address?.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            var bytes = address.GetAddressBytes();
            Array.Clear(bytes, 8, 8); // /64: changing an IPv6 privacy suffix does not mint another bucket.
            address = new System.Net.IPAddress(bytes);
        }
        return $"ip:{address}";
    }
    /// <summary>Existing endpoint limits, acquired in addition to the global limiter.</summary>
    public static void ConfigureEndpointPolicies(RateLimiterOptions options)
    {
        // Applies before multipart model binding and remains held until FileStreamResult finishes/aborts.
        options.AddPolicy(RateLimitPolicies.ExpenseFiles, _ =>
            RateLimitPartition.GetConcurrencyLimiter("admin-expense-files",
                _ => new ConcurrencyLimiterOptions { PermitLimit = 4, QueueLimit = 0 }));
        options.AddPolicy(RateLimitPolicies.DataExport, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        // Bounded active streaming responses per API replica; no waiting requests retain resources.
        options.AddPolicy(RateLimitPolicies.DataExportDownload, _ =>
            RateLimitPartition.GetConcurrencyLimiter("export-downloads",
                _ => new ConcurrencyLimiterOptions { PermitLimit = 4, QueueLimit = 0 }));
        options.AddPolicy(RateLimitPolicies.JupleIdLookup, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));
        options.AddPolicy(RateLimitPolicies.BillingGoogle, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
        options.AddPolicy(RateLimitPolicies.CollectionUnlock, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        // Per link AND per browser attempt id - never per link alone, which would let one client
        // exhaust the permits for everyone. The persisted link-wide ceiling lives in
        // CollectionUnlockBuckets (DB, cross-replica), not here.
        // Adding links through a writable public link: signed-in callers only, per identity - bounds
        // how fast one account can fill someone else's public Collection.
        options.AddPolicy(RateLimitPolicies.PublicCollectionWrite, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));
        // Sending Collection invitations: its own bucket (not the Juple ID lookup one), so inviting a
        // larger group - friends need no lookup - is not capped by lookups. Still bounded per identity:
        // an invitation is visible to its recipient, so this also limits invitation spam.
        options.AddPolicy(RateLimitPolicies.CollectionInvite, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));
        // Changing/resetting the one Collection lock password: 5 per 15 minutes per identity, on top of
        // the persisted wrong-current-password throttle and the recent sign-in a reset requires.
        options.AddPolicy(RateLimitPolicies.CollectionLockPassword, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(15), QueueLimit = 0 }));
        // Sending a support inquiry: per identity, so one account cannot fill the support queue.
        // Reporting and (un)blocking: per identity, so one account cannot flood the moderation queue or toggle blocks in a loop.
        options.AddPolicy(RateLimitPolicies.ReportCreate, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
        options.AddPolicy(RateLimitPolicies.BlockChange, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
        options.AddPolicy(RateLimitPolicies.SupportInquiryCreate, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.IdentityPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
        options.AddPolicy(RateLimitPolicies.PublicCollectionUnlock, httpContext =>
            RateLimitPartition.GetFixedWindowLimiter(
                RateLimitPolicies.PublicUnlockPartitionKey(httpContext),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    }
}
