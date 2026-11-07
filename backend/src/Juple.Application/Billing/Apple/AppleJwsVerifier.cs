using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;

namespace Juple.Application.Billing.Apple;

/// <summary>Verifies the compact JWS Apple signs every transaction, renewal info and notification with.</summary>
public interface IAppleJwsVerifier
{
    /// <summary>Returns the verified payload JSON. Throws <see cref="AppleSignatureException"/> for anything that does not verify.</summary>
    string VerifyAndGetPayload(string compactJws);
}

/// <summary>
/// ES256 JWS verification as Apple documents it: the header's <c>x5c</c> carries the certificate chain (leaf, intermediate, root); the chain
/// must lead to the pinned <b>Apple Root CA - G3</b> (not to whatever root the header names), the leaf must carry Apple's receipt-signing
/// extension and the intermediate Apple's WWDR extension, and the signature must verify with the leaf's public key. Revocation is not
/// checked online (Apple's own libraries do not by default; the notification and the API answer are cross-checked server-side anyway).
/// The trust anchors are injectable only for tests; production uses the embedded Apple root.
/// </summary>
public sealed class AppleJwsVerifier : IAppleJwsVerifier
{
    private const string LeafExtensionOid = "1.2.840.113635.100.6.11.1";
    private const string IntermediateExtensionOid = "1.2.840.113635.100.6.2.1";
    private const string EmbeddedRootName = "Juple.Application.Billing.Apple.Certificates.AppleRootCA-G3.cer";
    private const int MaxJwsLength = 64 * 1024;

    private readonly IReadOnlyList<X509Certificate2> trustedRoots;
    private readonly TimeProvider timeProvider;

    public AppleJwsVerifier(TimeProvider timeProvider)
        : this(LoadEmbeddedRoots(), timeProvider, requireAppleExtensions: true)
    {
    }

    public AppleJwsVerifier(IReadOnlyList<X509Certificate2> trustedRoots, TimeProvider timeProvider, bool requireAppleExtensions)
    {
        this.trustedRoots = trustedRoots;
        this.timeProvider = timeProvider;
        RequireAppleExtensions = requireAppleExtensions;
    }

    private bool RequireAppleExtensions { get; }

    public string VerifyAndGetPayload(string compactJws)
    {
        if (string.IsNullOrWhiteSpace(compactJws) || compactJws.Length > MaxJwsLength)
        {
            throw new AppleSignatureException("Not a JWS.");
        }

        var parts = compactJws.Split('.');
        if (parts.Length != 3)
        {
            throw new AppleSignatureException("Not a compact JWS.");
        }

        byte[] headerBytes, payloadBytes, signature;
        try
        {
            headerBytes = Base64UrlDecode(parts[0]);
            payloadBytes = Base64UrlDecode(parts[1]);
            signature = Base64UrlDecode(parts[2]);
        }
        catch (FormatException)
        {
            throw new AppleSignatureException("Malformed base64url.");
        }

        List<X509Certificate2> chain;
        try
        {
            using var header = JsonDocument.Parse(headerBytes);
            var root = header.RootElement;
            if (!root.TryGetProperty("alg", out var alg) || alg.GetString() != "ES256")
            {
                throw new AppleSignatureException("Unsupported algorithm.");
            }

            if (!root.TryGetProperty("x5c", out var x5c) || x5c.ValueKind != JsonValueKind.Array || x5c.GetArrayLength() < 2 || x5c.GetArrayLength() > 4)
            {
                throw new AppleSignatureException("Missing certificate chain.");
            }

            chain = x5c.EnumerateArray().Select(element => new X509Certificate2(Convert.FromBase64String(element.GetString() ?? string.Empty))).ToList();
        }
        catch (Exception exception) when (exception is JsonException or FormatException or CryptographicException or InvalidOperationException)
        {
            throw new AppleSignatureException("Malformed header.");
        }

        var leaf = chain[0];
        ValidateChain(chain);

        using var key = leaf.GetECDsaPublicKey() ?? throw new AppleSignatureException("The leaf certificate has no EC key.");
        var signedBytes = Encoding.ASCII.GetBytes(parts[0] + "." + parts[1]);
        var valid = false;
        try
        {
            valid = key.VerifyData(signedBytes, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch (CryptographicException)
        {
            // A signature of the wrong length: invalid.
        }

        if (!valid)
        {
            throw new AppleSignatureException("Signature mismatch.");
        }

        return Encoding.UTF8.GetString(payloadBytes);
    }

    private void ValidateChain(List<X509Certificate2> chain)
    {
        using var validator = new X509Chain();
        validator.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        foreach (var root in trustedRoots)
        {
            validator.ChainPolicy.CustomTrustStore.Add(root);
        }

        foreach (var certificate in chain.Skip(1))
        {
            validator.ChainPolicy.ExtraStore.Add(certificate);
        }

        validator.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        validator.ChainPolicy.VerificationTime = timeProvider.GetUtcNow().UtcDateTime;
        if (!validator.Build(chain[0]))
        {
            throw new AppleSignatureException("The certificate chain does not lead to the Apple root.");
        }

        if (RequireAppleExtensions)
        {
            if (!HasExtension(chain[0], LeafExtensionOid))
            {
                throw new AppleSignatureException("The leaf certificate is not an Apple receipt-signing certificate.");
            }

            // The element after the leaf in the BUILT chain is the intermediate.
            if (validator.ChainElements.Count < 3 || !HasExtension(validator.ChainElements[1].Certificate, IntermediateExtensionOid))
            {
                throw new AppleSignatureException("The intermediate certificate is not Apple's.");
            }
        }
    }

    private static bool HasExtension(X509Certificate2 certificate, string oid) =>
        certificate.Extensions.Cast<X509Extension>().Any(extension => extension.Oid?.Value == oid);

    private static byte[] Base64UrlDecode(string value)
    {
        var text = value.Replace('-', '+').Replace('_', '/');
        text = text.PadRight(text.Length + ((4 - (text.Length % 4)) % 4), '=');
        return Convert.FromBase64String(text);
    }

    private static IReadOnlyList<X509Certificate2> LoadEmbeddedRoots()
    {
        using var stream = typeof(AppleJwsVerifier).Assembly.GetManifestResourceStream(EmbeddedRootName)
            ?? throw new InvalidOperationException("The embedded Apple root certificate is missing.");
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return [new X509Certificate2(buffer.ToArray())];
    }
}
