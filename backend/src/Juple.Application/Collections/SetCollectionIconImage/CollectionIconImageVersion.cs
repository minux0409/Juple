using System.Security.Cryptography;
using System.Text;

namespace Juple.Application.Collections.SetCollectionIconImage;

/// <summary>
/// The stable identity of a Collection's icon photo, sent next to its short-lived read URL. Every
/// upload gets a new Blob name (see ICollectionIconImageStorage), so this changes exactly when the
/// photo is replaced or removed - never per response the way the signed URL does. A one-way digest
/// rather than the Blob name itself, so storage layout never leaves the server.
/// </summary>
public static class CollectionIconImageVersion
{
    public static string From(string blobName) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(blobName)), 0, 8);
}
