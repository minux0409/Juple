using System.Security.Cryptography;
using System.Text;

namespace Juple.Domain.Push;

/// <summary>
/// Which APNs gateway issued an iOS device token - the value of the app's <c>aps-environment</c> entitlement. A token only works on the
/// gateway that issued it: an Xcode (debug) build gets "development" tokens (sandbox gateway), TestFlight and App Store builds get
/// "production" tokens. Recorded per iOS registration, so one backend can deliver to both. Numeric values are persisted; never reorder.
/// Android registrations carry none.
/// </summary>
public enum ApnsEnvironment : byte
{
    Production = 0,
    Development = 1,
}

/// <summary>
/// The SHA-256 of a push token, exactly as SQL Server's persisted computed column <c>PushTokenHash</c> computes it
/// (<c>HASHBYTES('SHA2_256', [PushToken])</c> over the varchar value - FCM and APNs tokens are plain ASCII, so its bytes are the UTF-8
/// bytes) - so "is this token already enabled on another registration" is an indexed lookup instead of a scan of a 1024-character
/// column. Not a secret-protection measure.
/// </summary>
public static class PushTokenHash
{
    public static byte[] Of(string pushToken) => SHA256.HashData(Encoding.UTF8.GetBytes(pushToken));
}
