using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using Juple.Application.Billing;
using Juple.Application.Billing.Apple;
using Juple.UnitTests.Billing.GooglePlay;

namespace Juple.UnitTests.Billing.Apple;

/// <summary>
/// A throw-away certificate authority shaped like Apple's: root -> intermediate (carrying Apple's WWDR extension OID) -> leaf (carrying the
/// receipt-signing OID). The verifier under test is given this root instead of the pinned Apple one, so every signature and chain rule is
/// exercised without touching Apple.
/// </summary>
public sealed class AppleTestPki : IDisposable
{
    private readonly ECDsa _rootKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _intermediateKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    private readonly ECDsa _leafKey = ECDsa.Create(ECCurve.NamedCurves.nistP256);

    public AppleTestPki(DateTimeOffset now, bool leafExtension = true, bool intermediateExtension = true, TimeSpan? leafLifetime = null)
    {
        var notBefore = now.AddDays(-30);
        var rootRequest = new CertificateRequest("CN=Test Apple Root", _rootKey, HashAlgorithmName.SHA256);
        rootRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        Root = rootRequest.CreateSelfSigned(notBefore, now.AddYears(10));

        var intermediateRequest = new CertificateRequest("CN=Test Apple Intermediate", _intermediateKey, HashAlgorithmName.SHA256);
        intermediateRequest.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
        if (intermediateExtension)
        {
            intermediateRequest.CertificateExtensions.Add(new X509Extension(new Oid("1.2.840.113635.100.6.2.1"), [5, 0], false));
        }

        Intermediate = intermediateRequest.Create(Root.SubjectName, X509SignatureGenerator.CreateForECDsa(_rootKey), notBefore, now.AddYears(5), [1, 2, 3, 4]);

        var leafRequest = new CertificateRequest("CN=Test Apple Leaf", _leafKey, HashAlgorithmName.SHA256);
        if (leafExtension)
        {
            leafRequest.CertificateExtensions.Add(new X509Extension(new Oid("1.2.840.113635.100.6.11.1"), [5, 0], false));
        }

        Leaf = leafRequest.Create(Intermediate.SubjectName, X509SignatureGenerator.CreateForECDsa(_intermediateKey), notBefore, now + (leafLifetime ?? TimeSpan.FromDays(365)), [5, 6, 7, 8]);
    }

    public X509Certificate2 Root { get; }

    public X509Certificate2 Intermediate { get; }

    public X509Certificate2 Leaf { get; }

    /// <summary>A compact ES256 JWS signed by the leaf, with the chain in <c>x5c</c>.</summary>
    public string Sign(object payload, string algorithm = "ES256", bool includeChain = true)
    {
        var header = new Dictionary<string, object> { ["alg"] = algorithm };
        if (includeChain)
        {
            header["x5c"] = new[] { Convert.ToBase64String(Leaf.RawData), Convert.ToBase64String(Intermediate.RawData), Convert.ToBase64String(Root.RawData) };
        }

        var encodedHeader = Base64Url(JsonSerializer.SerializeToUtf8Bytes(header));
        var encodedPayload = Base64Url(JsonSerializer.SerializeToUtf8Bytes(payload));
        var signature = _leafKey.SignData(Encoding.ASCII.GetBytes($"{encodedHeader}.{encodedPayload}"), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return $"{encodedHeader}.{encodedPayload}.{Base64Url(signature)}";
    }

    public AppleJwsVerifier Verifier(TimeProvider time, bool requireAppleExtensions = true) => new([Root], time, requireAppleExtensions);

    public static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public void Dispose()
    {
        _rootKey.Dispose();
        _intermediateKey.Dispose();
        _leafKey.Dispose();
    }
}

public sealed class FakeAppleStoreServerClient : IAppleStoreServerClient
{
    private readonly Dictionary<string, AppleSubscriptionSnapshot> _snapshots = [];
    private readonly Dictionary<string, Exception> _failures = [];

    public int Calls { get; private set; }

    public List<(string Id, AppleEnvironment Environment)> Requests { get; } = [];

    public void Set(AppleSubscriptionSnapshot snapshot) => _snapshots[snapshot.Transaction.OriginalTransactionId] = snapshot;

    public void Fail(string originalTransactionId, Exception exception) => _failures[originalTransactionId] = exception;

    public void ClearFailure(string originalTransactionId) => _failures.Remove(originalTransactionId);

    public Task<AppleSubscriptionSnapshot> GetSubscriptionStatusAsync(string originalTransactionId, AppleEnvironment environment, CancellationToken cancellationToken = default)
    {
        Calls++;
        Requests.Add((originalTransactionId, environment));
        if (_failures.TryGetValue(originalTransactionId, out var failure))
        {
            throw failure;
        }

        return _snapshots.TryGetValue(originalTransactionId, out var snapshot) ? Task.FromResult(snapshot) : throw new AppleTransactionNotFoundException();
    }
}

public sealed class FakeAppleBillingStore : FakeGoogleBillingStore, IAppleBillingStore;

public static class AppleTestData
{
    public const string Bundle = "com.juple.app";
    public const string Monthly = "com.juple.app.membership.monthly";
    public const string Yearly = "com.juple.app.membership.yearly";

    public static BillingOptions Options(bool enabled = true, bool acceptSandbox = true) => new()
    {
        TrialIdentityHashKey = GoogleTestData.Key32C,
        Apple = new AppleBillingOptions
        {
            Enabled = enabled,
            BundleId = Bundle,
            ProductIds = [Monthly, Yearly],
            AcceptSandbox = acceptSandbox,
            IssuerId = "00000000-0000-0000-0000-000000000000",
            KeyId = "ABCDE12345",
            PrivateKeyPem = "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
            AccountTokenKey = GoogleTestData.Key32,
            HandleEncryptionKey = GoogleTestData.Key32B,
        },
    };

    public static AppleTransaction Transaction(
        string originalId = "1000000000000001",
        string productId = Monthly,
        Guid? token = null,
        AppleEnvironment environment = AppleEnvironment.Production,
        DateTimeOffset? expires = null,
        DateTimeOffset? revoked = null,
        string bundleId = Bundle,
        string type = "Auto-Renewable Subscription") => new(
        TransactionId: originalId + "9",
        OriginalTransactionId: originalId,
        BundleId: bundleId,
        ProductId: productId,
        PurchaseDateUtc: null,
        OriginalPurchaseDateUtc: new DateTimeOffset(2026, 12, 1, 0, 0, 0, TimeSpan.Zero),
        ExpiresDateUtc: expires,
        RevocationDateUtc: revoked,
        AppAccountToken: token,
        Environment: environment,
        Type: type);

    public static AppleSubscriptionSnapshot Snapshot(AppleTransaction transaction, AppleSubscriptionStatus status = AppleSubscriptionStatus.Active, AppleRenewalInfo? renewal = null) =>
        new(status, transaction, renewal);

    /// <summary>The JSON Apple puts in a signed transaction (<c>JWSTransactionDecodedPayload</c>).</summary>
    public static Dictionary<string, object?> TransactionPayload(AppleTransaction transaction) => new()
    {
        ["transactionId"] = transaction.TransactionId,
        ["originalTransactionId"] = transaction.OriginalTransactionId,
        ["bundleId"] = transaction.BundleId,
        ["productId"] = transaction.ProductId,
        ["purchaseDate"] = transaction.PurchaseDateUtc?.ToUnixTimeMilliseconds(),
        ["originalPurchaseDate"] = transaction.OriginalPurchaseDateUtc?.ToUnixTimeMilliseconds(),
        ["expiresDate"] = transaction.ExpiresDateUtc?.ToUnixTimeMilliseconds(),
        ["revocationDate"] = transaction.RevocationDateUtc?.ToUnixTimeMilliseconds(),
        ["appAccountToken"] = transaction.AppAccountToken?.ToString("D"),
        ["environment"] = transaction.Environment.ToString(),
        ["type"] = transaction.Type,
    };

    public static Dictionary<string, object?> NotificationPayload(string uuid, string type, string? subtype, string? signedTransaction, string bundleId = Bundle, AppleEnvironment environment = AppleEnvironment.Production)
    {
        var payload = new Dictionary<string, object?> { ["notificationType"] = type, ["notificationUUID"] = uuid, ["subtype"] = subtype, ["version"] = "2.0" };
        if (signedTransaction is not null)
        {
            payload["data"] = new Dictionary<string, object?> { ["environment"] = environment.ToString(), ["bundleId"] = bundleId, ["signedTransactionInfo"] = signedTransaction };
        }

        return payload;
    }
}
