using System.Security.Cryptography;

namespace Juple.Application.Collections;

/// <summary>
/// Generates the unguessable PublicId embedded in a Collection's public share URL. 24
/// cryptographically random bytes (192 bits of entropy - well beyond typical bearer-token
/// strength) Base64Url-encode to exactly 32 characters with no padding (24 is evenly divisible by
/// 3), so the result is fixed-length and URL-safe with no trimming needed - never a sequential id
/// or a short human-readable slug.
/// </summary>
internal static class CollectionSharePublicIdGenerator
{
    private const int TokenByteLength = 24;

    internal static string Generate()
    {
        var bytes = RandomNumberGenerator.GetBytes(TokenByteLength);
        return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_');
    }
}
