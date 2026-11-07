using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Juple.Application.Billing;
using Juple.Application.Billing.Apple;

namespace Juple.Infrastructure.Billing;

/// <summary>
/// The App Store Server API "Get All Subscription Statuses" call. Authenticated with a short-lived ES256 JWT signed by the in-app purchase
/// key (issuer id, key id and the .p8 PEM from <see cref="AppleBillingOptions"/> - secrets, never logged); every signed value in the
/// answer is verified with <see cref="IAppleJwsVerifier"/> before it is read. The Sandbox and the Production hosts are chosen by the
/// transaction's own environment, never by a guess. No retry loop here: a failure surfaces as <see cref="AppleUnavailableException"/> and the
/// caller's back-off owns the retry.
/// </summary>
public sealed class AppleStoreServerClient(HttpClient http, BillingOptions options, IAppleJwsVerifier jws, TimeProvider timeProvider) : IAppleStoreServerClient
{
    private const string ProductionHost = "https://api.storekit.itunes.apple.com";
    private const string SandboxHost = "https://api.storekit-sandbox.itunes.apple.com";
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(20);

    private readonly object tokenLock = new();
    private string? cachedToken;
    private DateTimeOffset cachedTokenExpiresAtUtc;

    public async Task<AppleSubscriptionSnapshot> GetSubscriptionStatusAsync(string originalTransactionId, AppleEnvironment environment, CancellationToken cancellationToken = default)
    {
        var host = environment == AppleEnvironment.Production ? ProductionHost : SandboxHost;
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{host}/inApps/v1/subscriptions/{Uri.EscapeDataString(originalTransactionId)}");
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", GetToken());

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException && !cancellationToken.IsCancellationRequested)
        {
            throw new AppleUnavailableException("The App Store Server API could not be reached.");
        }

        using (response)
        {
            switch (response.StatusCode)
            {
                case HttpStatusCode.OK:
                    break;
                case HttpStatusCode.NotFound:
                case HttpStatusCode.BadRequest:
                    // 4040010 TransactionIdNotFoundError / 4000008 InvalidOriginalTransactionIdError: Apple does not know it here.
                    throw new AppleTransactionNotFoundException();
                default:
                    // 401 (our credential), 403, 429 (rate limit), 5xx: nothing about the purchase is known - retry later.
                    throw new AppleUnavailableException($"The App Store Server API answered {(int)response.StatusCode}.");
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            return Parse(body, originalTransactionId);
        }
    }

    private AppleSubscriptionSnapshot Parse(string body, string originalTransactionId)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.TryGetProperty("data", out var groups) && groups.ValueKind == JsonValueKind.Array)
            {
                foreach (var group in groups.EnumerateArray())
                {
                    if (!group.TryGetProperty("lastTransactions", out var transactions) || transactions.ValueKind != JsonValueKind.Array)
                    {
                        continue;
                    }

                    foreach (var entry in transactions.EnumerateArray())
                    {
                        if (entry.TryGetProperty("originalTransactionId", out var id) && id.GetString() == originalTransactionId
                            && entry.TryGetProperty("status", out var status) && status.TryGetInt32(out var statusCode)
                            && entry.TryGetProperty("signedTransactionInfo", out var signedTransaction) && signedTransaction.GetString() is { } signed)
                        {
                            var transaction = ApplePayloads.ParseTransaction(jws.VerifyAndGetPayload(signed));
                            AppleRenewalInfo? renewal = entry.TryGetProperty("signedRenewalInfo", out var signedRenewal) && signedRenewal.GetString() is { } renewalJws
                                ? ApplePayloads.ParseRenewal(jws.VerifyAndGetPayload(renewalJws))
                                : null;
                            return new AppleSubscriptionSnapshot((AppleSubscriptionStatus)statusCode, transaction, renewal);
                        }
                    }
                }
            }
        }
        catch (Exception exception) when (exception is JsonException or AppleSignatureException or InvalidOperationException)
        {
            throw new AppleMalformedException("The App Store Server API answer could not be verified.");
        }

        throw new AppleTransactionNotFoundException();
    }

    private string GetToken()
    {
        var now = timeProvider.GetUtcNow();
        lock (tokenLock)
        {
            if (cachedToken is not null && cachedTokenExpiresAtUtc - now > TimeSpan.FromMinutes(2))
            {
                return cachedToken;
            }

            var apple = options.Apple;
            if (string.IsNullOrWhiteSpace(apple.PrivateKeyPem) || string.IsNullOrWhiteSpace(apple.KeyId) || string.IsNullOrWhiteSpace(apple.IssuerId))
            {
                throw new InvalidOperationException("Billing:Apple credentials are not configured.");
            }

            var expires = now + TokenLifetime;
            var header = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { alg = "ES256", kid = apple.KeyId, typ = "JWT" }));
            var payload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new { iss = apple.IssuerId, iat = now.ToUnixTimeSeconds(), exp = expires.ToUnixTimeSeconds(), aud = "appstoreconnect-v1", bid = apple.BundleId }));
            using var key = ECDsa.Create();
            key.ImportFromPem(apple.PrivateKeyPem);
            var signature = key.SignData(Encoding.ASCII.GetBytes($"{header}.{payload}"), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
            cachedToken = $"{header}.{payload}.{Base64Url(signature)}";
            cachedTokenExpiresAtUtc = expires;
            return cachedToken;
        }
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
