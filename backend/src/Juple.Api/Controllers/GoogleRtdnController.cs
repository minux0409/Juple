using System.Text;
using System.Text.Json;
using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// Google Play Real-time Developer Notifications, delivered by a Pub/Sub PUSH subscription. This is NOT a Juple-login endpoint: Pub/Sub
/// authenticates with an OIDC token, which is verified (signature, audience, and the configured push service account) BEFORE the body is
/// read. A notification is only a trigger: it is stored durably and idempotently (the Pub/Sub message id is the event id), the worker is
/// woken, and the worker asks Google for the authoritative state - nothing here ever sets an entitlement from a notification type.
/// There is deliberately no IP-based rate limit (it could throttle Google's own retries): authentication and idempotency are the defence.
/// </summary>
[ApiController]
[Route("api/v1/billing/google/rtdn")]
[AllowAnonymous]
public sealed class GoogleRtdnController(
    BillingOptions options,
    IPubSubPushAuthenticator authenticator,
    IGoogleBillingProcessor processor) : ControllerBase
{
    private const int MaxBodyBytes = 64 * 1024;

    [HttpPost]
    public async Task<IActionResult> ReceiveAsync(CancellationToken cancellationToken)
    {
        if (!options.Google.Enabled)
        {
            return NotFound();
        }

        // 1. Authenticate FIRST. The header is never logged.
        if (!await authenticator.AuthenticateAsync(Request.Headers.Authorization.ToString(), cancellationToken))
        {
            return Unauthorized();
        }

        // 2. Only now read (a bounded) body.
        PubSubPushEnvelope? envelope;
        try
        {
            using var limited = new MemoryStream();
            await Request.Body.CopyToAsync(limited, cancellationToken);
            if (limited.Length is 0 or > MaxBodyBytes)
            {
                return BadRequest();
            }

            envelope = JsonSerializer.Deserialize<PubSubPushEnvelope>(limited.ToArray(), JsonOptions);
        }
        catch (JsonException)
        {
            return BadRequest();
        }

        var messageId = envelope?.Message?.MessageId;
        var data = envelope?.Message?.Data;
        if (string.IsNullOrWhiteSpace(messageId) || messageId.Length > 200 || string.IsNullOrWhiteSpace(data))
        {
            return BadRequest();
        }

        // 3. Parse the notification and check it is for this app.
        GoogleNotification? notification;
        try
        {
            notification = ParseNotification(data, options.Google.PackageName);
        }
        catch (Exception exception) when (exception is FormatException or JsonException)
        {
            return BadRequest();
        }

        if (notification is null)
        {
            return BadRequest();
        }

        // 4. Durable, idempotent, then wake the worker (best effort). A duplicate delivery is success, not an error.
        await processor.IngestAsync(messageId, notification, cancellationToken);
        return Ok();
    }

    /// <summary>
    /// Reduces the DeveloperNotification to its kind and (when it has one) the purchase token. Null = not for this app or not a notification
    /// this endpoint understands. Test notifications and kinds without a purchase are kept as tokenless events (processed as ignored).
    /// </summary>
    public static GoogleNotification? ParseNotification(string base64Data, string expectedPackageName)
    {
        var json = Convert.FromBase64String(base64Data);
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object
            || !root.TryGetProperty("packageName", out var package)
            || !string.Equals(package.GetString(), expectedPackageName, StringComparison.Ordinal))
        {
            return null;
        }

        DateTimeOffset? eventTime = null;
        if (root.TryGetProperty("eventTimeMillis", out var millis)
            && long.TryParse(millis.GetString(), out var epochMillis))
        {
            eventTime = DateTimeOffset.FromUnixTimeMilliseconds(epochMillis);
        }

        if (root.TryGetProperty("subscriptionNotification", out var subscription) && subscription.ValueKind == JsonValueKind.Object)
        {
            var token = subscription.TryGetProperty("purchaseToken", out var tokenElement) ? tokenElement.GetString() : null;
            var type = subscription.TryGetProperty("notificationType", out var typeElement) && typeElement.TryGetInt32(out var number) ? number : 0;
            return string.IsNullOrWhiteSpace(token) || token.Length > 4096
                ? null
                : new GoogleNotification($"subscription:{type}", token, eventTime);
        }

        if (root.TryGetProperty("voidedPurchaseNotification", out var voided) && voided.ValueKind == JsonValueKind.Object)
        {
            var token = voided.TryGetProperty("purchaseToken", out var tokenElement) ? tokenElement.GetString() : null;
            return string.IsNullOrWhiteSpace(token) || token.Length > 4096 ? null : new GoogleNotification("voided", token, eventTime);
        }

        if (root.TryGetProperty("testNotification", out _))
        {
            return new GoogleNotification("test", null, eventTime);
        }

        if (root.TryGetProperty("oneTimeProductNotification", out _))
        {
            return new GoogleNotification("oneTimeProduct", null, eventTime);
        }

        return null;
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public sealed record PubSubPushEnvelope(PubSubMessage? Message, string? Subscription);

    public sealed record PubSubMessage(string? Data, string? MessageId, string? PublishTime);
}
