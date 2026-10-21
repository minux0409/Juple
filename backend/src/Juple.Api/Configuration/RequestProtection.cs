using System.Diagnostics.Metrics;
using System.Globalization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Configuration;

/// <summary>Admission limits, all per API replica. These are NOT persisted daily quotas.</summary>
public sealed class RequestProtectionOptions
{
    public const string SectionName = "RequestProtection";
    public bool Enabled { get; set; } = true;
    // Enable only after the ingress peer / forwarded-header trust boundary is verified.
    public bool AnonymousIpLimitsEnabled { get; set; } = false;
    public int AccountPerMinute { get; set; } = 180;
    public int AnonymousPerMinute { get; set; } = 300;
    public int ReadPerMinute { get; set; } = 120;
    public int LinkPerMinute { get; set; } = 30;
    public int MetadataPerMinute { get; set; } = 30;
    public int ImagePerMinute { get; set; } = 15;
    public int CollectionCreatePerMinute { get; set; } = 15;
    public int SocialPerMinute { get; set; } = 40;
    public int PushPerMinute { get; set; } = 10;
    public int BulkPerMinute { get; set; } = 5;
    public int PasswordPer15Minutes { get; set; } = 5;
    public int PasswordVerificationPerMinute { get; set; } = 30;
    public int AdminPerMinute { get; set; } = 60;
    // The socket address may be shared by an ingress/NAT. Never trust arbitrary XFF values.
    public int PublicReadPerMinute { get; set; } = 240;
    public int MetadataPerAccountConcurrency { get; set; } = 2;
    public int MetadataOutboundConcurrency { get; set; } = 4;
    public int ImageConcurrency { get; set; } = 1;
    public int ImageQueue { get; set; } = 2;
    public int ImageRequestTimeoutSeconds { get; set; } = 120;
    public int PasswordConcurrency { get; set; } = 2;

    public void Validate()
    {
        foreach (var property in GetType().GetProperties().Where(p => p.PropertyType == typeof(int)))
        {
            var value = (int)property.GetValue(this)!;
            if (value < (property.Name == nameof(ImageQueue) ? 0 : 1) || value > 10000)
                throw new InvalidOperationException($"{SectionName}:{property.Name} is outside its supported range.");
        }
        if (ImageQueue > 16 || ImageConcurrency > 4 || ImageRequestTimeoutSeconds > 300 || PasswordConcurrency > 16 || MetadataPerAccountConcurrency > 16 || MetadataOutboundConcurrency > 16)
            throw new InvalidOperationException("RequestProtection concurrency/queue settings exceed the resource safety ceiling.");
    }
}

public static class RequestProtection
{
    public const string ImageTimeoutPolicy = "image-upload";
    private static readonly Meter Meter = new("Juple.RequestProtection", "1.0");
    private static readonly Counter<long> Rejections = Meter.CreateCounter<long>("juple.request.rejected");

    public static void Configure(RateLimiterOptions options, RequestProtectionOptions settings)
    {
        settings.Validate();
        // Built-in middleware acquires these BEFORE authorization/model binding and holds concurrency
        // leases through response completion. Endpoint-specific existing policies are ALSO acquired.
        options.GlobalLimiter = PartitionedRateLimiter.CreateChained(
            Fixed(settings, context => IsApi(context) && !IsIdentity(context) ? "anonymous" : null, _ => settings.AnonymousPerMinute),
            Fixed(settings, context => IsApi(context) && IsIdentity(context) ? "account" : null, _ => settings.AccountPerMinute),
            Fixed(settings, context => IsApi(context) ? Category(context) : null, category => category switch
            {
                "read" => settings.ReadPerMinute, "link" => settings.LinkPerMinute,
                "metadata" => settings.MetadataPerMinute, "image" => settings.ImagePerMinute,
                "collection-create" => settings.CollectionCreatePerMinute, "social" => settings.SocialPerMinute,
                "push" => settings.PushPerMinute, "bulk" => settings.BulkPerMinute,
                "password" => settings.PasswordPer15Minutes, "password-verify" => settings.PasswordVerificationPerMinute, "admin" => settings.AdminPerMinute,
                "public-read" => settings.PublicReadPerMinute, _ => settings.AccountPerMinute,
            }),
            PartitionedRateLimiter.Create<HttpContext, string>(context =>
                settings.Enabled && IsApi(context) && Category(context) is "metadata" or "link"
                    ? Concurrency("metadata-http-work", settings.MetadataOutboundConcurrency, 0)
                    : RateLimitPartition.GetNoLimiter("none")),
            PartitionedRateLimiter.Create<HttpContext, string>(context =>
            {
                if (!settings.Enabled || !IsApi(context)) return RateLimitPartition.GetNoLimiter("none");
                var category = Category(context);
                return category switch
                {
                    "image" => Concurrency("image-work", settings.ImageConcurrency, settings.ImageQueue),
                    "password" or "password-verify" => Concurrency("password-work", settings.PasswordConcurrency, 0),
                    "metadata" or "link" => Concurrency("metadata-account:" + RateLimitPolicies.IdentityPartitionKey(context), settings.MetadataPerAccountConcurrency, 0),
                    _ => RateLimitPartition.GetNoLimiter("none"),
                };
            }));
        options.OnRejected = async (context, cancellationToken) =>
        {
            var retry = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var value) ? value : TimeSpan.FromSeconds(2);
            await WriteRejectionAsync(context.HttpContext, retry, cancellationToken);
        };
    }

    public static async Task WriteRejectionAsync(HttpContext context, TimeSpan retry, CancellationToken cancellationToken)
    {
        // A fixed tag, no URL, identity, password, token, IP, or client-supplied policy names.
        Rejections.Add(1, new KeyValuePair<string, object?>("policy", "request-admission"));
        context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.Response.Headers.RetryAfter = Math.Max(1, (int)Math.Ceiling(retry.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        context.Response.Headers.CacheControl = "no-store";
        await context.Response.WriteAsJsonAsync(new ProblemDetails
        {
            Status = StatusCodes.Status429TooManyRequests,
            Title = "Too many requests",
            Extensions = { ["code"] = "rateLimited", ["policy"] = "request-admission" },
        }, options: null, contentType: "application/problem+json", cancellationToken: cancellationToken);
    }

    private static PartitionedRateLimiter<HttpContext> Fixed(RequestProtectionOptions settings,
        Func<HttpContext, string?> select, Func<string, int> permits) =>
        PartitionedRateLimiter.Create<HttpContext, string>(context =>
        {
            var category = settings.Enabled ? select(context) : null;
            if (!settings.AnonymousIpLimitsEnabled && !IsIdentity(context)) category = null;
            if (category is null) return RateLimitPartition.GetNoLimiter("none");
            return RateLimitPartition.GetFixedWindowLimiter(category + ":" + RateLimitPolicies.IdentityPartitionKey(context),
                _ => new FixedWindowRateLimiterOptions
                {
                    PermitLimit = permits(category), QueueLimit = 0,
                    Window = category == "password" ? TimeSpan.FromMinutes(15) : TimeSpan.FromMinutes(1),
                });
        });

    private static RateLimitPartition<string> Concurrency(string key, int count, int queue) =>
        RateLimitPartition.GetConcurrencyLimiter(key, _ => new ConcurrencyLimiterOptions
        {
            PermitLimit = count, QueueLimit = queue, QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
        });

    private static bool IsIdentity(HttpContext context) => RateLimitPolicies.IdentityPartitionKey(context).StartsWith("id:", StringComparison.Ordinal);
    private static bool IsApi(HttpContext context) => context.GetEndpoint()?.Metadata.GetMetadata<ControllerActionDescriptor>() is { ControllerName: not "GoogleRtdn" and not "AppUpdate" };

    // Controller/action metadata is server-defined; route IDs/query text never create limiter partitions.
    public static string? Category(HttpContext context)
    {
        var action = context.GetEndpoint()?.Metadata.GetMetadata<ControllerActionDescriptor>();
        if (action is null) return null;
        var controller = action.ControllerName;
        var name = action.ActionName;
        var write = !HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method);
        if (controller.StartsWith("Admin", StringComparison.Ordinal)) return "admin";
        if (!IsIdentity(context)) return controller == "PublicCollections" && !write ? "public-read" : null;
        if (write && !HttpMethods.IsDelete(context.Request.Method) && (controller == "ItemImages" || controller == "UserProfile" && name.Contains("Image", StringComparison.Ordinal)
            || controller == "Collections" && name.Contains("IconImage", StringComparison.Ordinal))) return "image";
        if (controller == "UrlMetadata") return "metadata";
        if (controller == "Inbox" && write) return "link";
        if (write && (controller.Contains("Copy", StringComparison.Ordinal) || controller.Contains("Merge", StringComparison.Ordinal)
            || name.Contains("Merge", StringComparison.Ordinal) || name.Contains("Copy", StringComparison.Ordinal) || name == "EmptyTrash")) return "bulk";
        // Logout cleanup must not consume the registration bucket after token/locale changes.
        if (HttpMethods.IsPut(context.Request.Method) && controller == "PushDevices") return "push";
        if (write && (controller == "CollectionLockSettings" || name is "SetSharePassword" or "RemoveSharePassword")) return "password";
        if (write && (name.Contains("Password", StringComparison.Ordinal) || name.Contains("Unlock", StringComparison.Ordinal) || name == "RemoveLock")) return "password-verify";
        if (write && controller == "Collections" && name == "Create") return "collection-create";
        if (!write) return "read";
        if (name.Contains("Comment", StringComparison.Ordinal) || name.Contains("Reaction", StringComparison.Ordinal)
            || name.Contains("Submission", StringComparison.Ordinal) || name.Contains("JoinRequest", StringComparison.Ordinal)
            || name.Contains("Invite", StringComparison.Ordinal)
            || controller.Contains("Comment", StringComparison.Ordinal) || controller.Contains("Reaction", StringComparison.Ordinal)
            || controller.Contains("Friend", StringComparison.Ordinal) || controller.Contains("Notification", StringComparison.Ordinal)
            || controller.Contains("Invitation", StringComparison.Ordinal) || controller.Contains("Submission", StringComparison.Ordinal)) return "social";
        return null;
    }
}
