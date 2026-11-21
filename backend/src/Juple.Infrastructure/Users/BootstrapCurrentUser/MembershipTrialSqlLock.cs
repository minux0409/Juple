using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users.BootstrapCurrentUser;

/// <summary>Cross-process email coordination, following push registration's transaction-owned SQL lock pattern.</summary>
internal static class MembershipTrialSqlLock
{
    internal static Task AcquireAsync(JupleDbContext db, byte[] emailHash, CancellationToken ct)
    {
        if (emailHash.Length != 32) throw new ArgumentException("A trial HMAC must contain 32 bytes.", nameof(emailHash));
        var resource = "membership-trial-email:" + Convert.ToHexString(emailHash);
        // No raw email/identity. Negative results (timeout, cancellation, deadlock victim) fail
        // explicitly; transaction disposal rolls everything back. A new request can safely retry.
        return db.Database.ExecuteSqlInterpolatedAsync($"DECLARE @result int; EXEC @result = sp_getapplock @Resource={resource}, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=15000; IF @result < 0 THROW 51001, 'Membership trial coordination lock unavailable.', 1;", ct);
    }
}
