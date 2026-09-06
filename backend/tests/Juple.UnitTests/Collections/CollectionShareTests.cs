using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class CollectionShareTests
{
    private static readonly DateTimeOffset CreatedAtUtc = new(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Constructor_IsActiveByDefault()
    {
        var share = new CollectionShare(41, "abc123", CreatedAtUtc);

        Assert.True(share.IsActive);
        Assert.Null(share.RevokedAtUtc);
        Assert.Equal(CreatedAtUtc, share.CreatedAtUtc);
        Assert.Equal(CreatedAtUtc, share.UpdatedAtUtc);
    }

    [Fact]
    public void Revoke_SetsInactiveAndRevokedAtUtc()
    {
        var share = new CollectionShare(41, "abc123", CreatedAtUtc);
        var revokedAtUtc = CreatedAtUtc.AddDays(1);

        share.Revoke(revokedAtUtc);

        Assert.False(share.IsActive);
        Assert.Equal(revokedAtUtc, share.RevokedAtUtc);
        Assert.Equal(revokedAtUtc, share.UpdatedAtUtc);
    }

    [Fact]
    public void Revoke_WhenAlreadyRevoked_IsNoOpAndDoesNotTouchUpdatedAtUtcOrRevokedAtUtc()
    {
        var share = new CollectionShare(41, "abc123", CreatedAtUtc);
        var firstRevokeAtUtc = CreatedAtUtc.AddDays(1);
        share.Revoke(firstRevokeAtUtc);

        share.Revoke(CreatedAtUtc.AddDays(2));

        Assert.Equal(firstRevokeAtUtc, share.RevokedAtUtc);
        Assert.Equal(firstRevokeAtUtc, share.UpdatedAtUtc);
    }
}
