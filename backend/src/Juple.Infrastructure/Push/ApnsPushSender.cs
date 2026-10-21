using System.Buffers;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using Juple.Application.Push;
using Juple.Domain.Push;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Push;

/// <summary>
/// The iOS IPushSender: Apple's HTTP/2 Provider API directly (POST /3/device/{token}), authenticated with a provider JWT
/// (<see cref="ApnsProviderTokenSource"/>) - no Firebase, no Notification Hubs. The HttpClient comes from IHttpClientFactory with an
/// HTTP/2-only, long-lived pooled handler, so connections to APNs are reused across sends as Apple asks.
///
/// Message shape, matching what the Android FCM message carries:
/// - visible: aps.alert {title, body}, sound "default", badge when the server has a count; apns-push-type alert, priority 10;
/// - data-only (a refresh signal): aps.content-available 1 and no alert; apns-push-type background, priority 5;
/// - the same custom keys as FCM's data map (type, notificationId, collectionId/publicId/invitationId) at the top level, as strings;
/// - apns-expiration = the payload's ExpiresAtUtc (the notification's MaxAge), apns-collapse-id = the notification id, so a resend of the
///   same notification after a crash (at-least-once delivery) replaces the banner on the phone instead of showing a second one.
///
/// Every failure is classified into PushSendFailureCodes and returned, never thrown. Only an EXPIRED provider token is retried
/// here (once, with a freshly signed JWT); any other credential refusal blocks that gateway for a cooldown (no calls to Apple, see
/// ApnsProviderTokenSource.AuthenticationCooldown). Every other transient failure is the dispatch pipeline's retry. Neither the device token nor
/// the JWT nor the response body is ever logged - only the registration id, the HTTP status, APNs' reason code and the apns-id.
/// </summary>
public sealed partial class ApnsPushSender(
    IHttpClientFactory httpClientFactory,
    ApnsProviderTokenSource tokenSource,
    ApnsOptions options,
    ILogger<ApnsPushSender> logger) : IPushSender
{
    public const string HttpClientName = "apns";

    public async Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
    {
        if (device.Platform != PushPlatform.Ios)
        {
            // Routing is PlatformPushSender's job; reaching here with another platform is a programmer error.
            throw new ArgumentException("ApnsPushSender only sends to iOS registrations.", nameof(device));
        }

        var environment = device.ApnsEnvironment ?? ApnsEnvironment.Production;
        if (tokenSource.IsAuthenticationBlocked(environment))
        {
            // APNs refused our credentials moments ago: fail at once, without calling Apple (see ApnsProviderTokenSource).
            return PushSendResult.Failed(PushSendFailureCodes.ThirdPartyAuthError);
        }

        var body = BuildBody(payload);
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(options.SendTimeoutSeconds));
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);
        try
        {
            var outcome = await SendOnceAsync(device, payload, body, linkedCts.Token);
            if (outcome.ProviderTokenExpired)
            {
                // ExpiredProviderToken only: the cached JWT aged out (clock drift, a long pause) - sign a new one and try exactly once more.
                outcome = await SendOnceAsync(device, payload, body, linkedCts.Token);
            }

            if (outcome.Result.FailureCode == PushSendFailureCodes.ThirdPartyAuthError)
            {
                // Invalid/unrelated key, wrong team, a key not allowed on this gateway, or an expiry that a fresh token did not cure.
                tokenSource.BlockAuthentication(environment);
                Log.AuthenticationBlocked(logger, environment.ToString(), (int)ApnsProviderTokenSource.AuthenticationCooldown.TotalMinutes);
            }

            return outcome.Result;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return PushSendResult.Failed(PushSendFailureCodes.SendTimeout);
        }
        catch (HttpRequestException exception)
        {
            // Connection refused/reset, DNS, TLS: transient. The exception message is not logged (it can carry the request URI).
            Log.TransportFailed(logger, device.Id, exception.GetType().Name);
            return PushSendResult.Failed(PushSendFailureCodes.Unavailable);
        }
    }

    private async Task<(PushSendResult Result, bool ProviderTokenExpired)> SendOnceAsync(
        PushDeviceRegistration device, PushNotificationPayload payload, byte[] body, CancellationToken cancellationToken)
    {
        var jwt = tokenSource.GetToken();
        using var request = BuildRequest(device, payload, body, jwt, options);
        using var response = await httpClientFactory.CreateClient(HttpClientName).SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        var apnsId = response.Headers.TryGetValues("apns-id", out var ids) ? ids.FirstOrDefault() : null;
        if (response.IsSuccessStatusCode)
        {
            return (PushSendResult.Sent(apnsId), false);
        }

        var reason = await ReadReasonAsync(response, cancellationToken);
        var code = Classify(response.StatusCode, reason);
        Log.Rejected(logger, device.Id, (int)response.StatusCode, reason ?? "-", apnsId ?? "-", code);
        if (response.StatusCode == HttpStatusCode.Forbidden && reason == "ExpiredProviderToken")
        {
            tokenSource.Invalidate(jwt);
            return (PushSendResult.Failed(code), true);
        }

        return (PushSendResult.Failed(code), false);
    }

    /// <summary>The request for one device - pure, so the exact headers, path and body are unit-tested.</summary>
    public static HttpRequestMessage BuildRequest(PushDeviceRegistration device, PushNotificationPayload payload, byte[] body, string jwt, ApnsOptions options)
    {
        var endpoint = device.ApnsEnvironment == ApnsEnvironment.Development ? options.DevelopmentEndpoint : options.ProductionEndpoint;
        var isDataOnly = IsDataOnly(payload);
        var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(endpoint.TrimEnd('/') + "/"), $"3/device/{device.PushToken}"))
        {
            Version = HttpVersion.Version20,
            VersionPolicy = HttpVersionPolicy.RequestVersionExact,
            Content = new ByteArrayContent(body),
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        request.Headers.Authorization = new AuthenticationHeaderValue("bearer", jwt);
        request.Headers.TryAddWithoutValidation("apns-topic", options.BundleId);
        request.Headers.TryAddWithoutValidation("apns-push-type", isDataOnly ? "background" : "alert");
        // Apple requires priority 5 for background pushes; 10 delivers a visible one immediately.
        request.Headers.TryAddWithoutValidation("apns-priority", isDataOnly ? "5" : "10");
        request.Headers.TryAddWithoutValidation("apns-collapse-id", $"n{payload.NotificationId}");
        if (payload.ExpiresAtUtc is { } expiresAt)
        {
            request.Headers.TryAddWithoutValidation("apns-expiration", Math.Max(1, expiresAt.ToUnixTimeSeconds()).ToString(System.Globalization.CultureInfo.InvariantCulture));
        }

        return request;
    }

    /// <summary>The JSON body: aps plus the same custom keys the Android message carries in its data map.</summary>
    public static byte[] BuildBody(PushNotificationPayload payload)
    {
        var buffer = new ArrayBufferWriter<byte>(512);
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteStartObject("aps");
            if (IsDataOnly(payload))
            {
                writer.WriteNumber("content-available", 1);
            }
            else
            {
                writer.WriteStartObject("alert");
                writer.WriteString("title", payload.Title);
                writer.WriteString("body", payload.Body);
                writer.WriteEndObject();
                writer.WriteString("sound", "default");
                if (payload.BadgeCount is { } badge)
                {
                    writer.WriteNumber("badge", Math.Max(0, badge));
                }
            }

            writer.WriteEndObject();
            foreach (var (key, value) in FirebaseCloudMessagingSender.BuildDataPayload(payload))
            {
                if (!string.Equals(key, "aps", StringComparison.Ordinal))
                {
                    writer.WriteString(key, value);
                }
            }

            writer.WriteEndObject();
        }

        return buffer.WrittenSpan.ToArray();
    }

    /// <summary>
    /// APNs status + reason -> the transport-agnostic code (https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns).
    /// Permanent (the registration is disabled): 410 Unregistered/ExpiredToken, 400 BadDeviceToken, 400 DeviceTokenNotForTopic. A
    /// provider-credential problem (403) is never the device's fault and never disables it.
    /// </summary>
    public static string Classify(HttpStatusCode status, string? reason) => (status, reason) switch
    {
        (HttpStatusCode.Gone, _) => PushSendFailureCodes.Unregistered,
        (_, "Unregistered" or "ExpiredToken") => PushSendFailureCodes.Unregistered,
        (_, "BadDeviceToken") => PushSendFailureCodes.BadDeviceToken,
        (_, "DeviceTokenNotForTopic") => PushSendFailureCodes.TokenNotForTopic,
        (HttpStatusCode.Forbidden, _) => PushSendFailureCodes.ThirdPartyAuthError,
        (HttpStatusCode.TooManyRequests, _) => PushSendFailureCodes.QuotaExceeded,
        (HttpStatusCode.ServiceUnavailable, _) => PushSendFailureCodes.Unavailable,
        (HttpStatusCode.InternalServerError, _) => PushSendFailureCodes.Internal,
        (HttpStatusCode.BadRequest or HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed or HttpStatusCode.RequestEntityTooLarge, _) => PushSendFailureCodes.InvalidArgument,
        _ when (int)status >= 500 => PushSendFailureCodes.Unavailable,
        _ => PushSendFailureCodes.UnknownError,
    };

    private static bool IsDataOnly(PushNotificationPayload payload) => payload.Title is null || payload.Body is null;

    /// <summary>APNs answers errors with {"reason": "..."} (and 410 adds a timestamp). Anything unreadable is simply no reason.</summary>
    private static async Task<string?> ReadReasonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        try
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken);
            if (string.IsNullOrWhiteSpace(text) || text.Length > 4096)
            {
                return null;
            }

            using var document = JsonDocument.Parse(text);
            return document.RootElement.TryGetProperty("reason", out var reason) && reason.ValueKind == JsonValueKind.String
                ? SafeReason(reason.GetString())
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Reasons are short ASCII identifiers; anything else is not logged verbatim.</summary>
    private static string? SafeReason(string? reason) =>
        reason is { Length: > 0 and <= 64 } && reason.All(char.IsAsciiLetterOrDigit) ? reason : null;

    private static partial class Log
    {
        [LoggerMessage(EventId = 7301, Level = LogLevel.Warning, Message = "APNs rejected a push to registration {RegistrationId}: status {Status}, reason {Reason}, apns-id {ApnsId}, classified {FailureCode}.")]
        public static partial void Rejected(ILogger logger, long registrationId, int status, string reason, string apnsId, string failureCode);

        [LoggerMessage(EventId = 7302, Level = LogLevel.Warning, Message = "APNs could not be reached for registration {RegistrationId} ({ExceptionType}).")]
        public static partial void TransportFailed(ILogger logger, long registrationId, string exceptionType);

        [LoggerMessage(EventId = 7304, Level = LogLevel.Error, Message = "APNs refused this server's credentials on the {Environment} gateway; sends there fail fast for {Minutes} minutes. Check Apns:KeyId, Apns:TeamId and Apns:PrivateKeyPem.")]
        public static partial void AuthenticationBlocked(ILogger logger, string environment, int minutes);
    }
}
