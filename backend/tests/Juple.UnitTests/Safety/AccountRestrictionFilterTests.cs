using Juple.Api.Safety;

namespace Juple.UnitTests.Safety;

/// <summary>What a restricted (read-only) account may still do: read everything, and a small set of safety / account endpoints - never content changes.</summary>
public sealed class AccountRestrictionFilterTests
{
    [Theory]
    [InlineData("GET", "/api/v1/collections")]
    [InlineData("GET", "/api/v1/items/5")]
    [InlineData("HEAD", "/api/v1/items/5")]
    [InlineData("POST", "/api/v1/users/me/bootstrap")]
    [InlineData("DELETE", "/api/v1/users/me")]
    [InlineData("POST", "/api/v1/users/ABCD2345/block")]
    [InlineData("POST", "/api/v1/moderation-notices/7/acknowledge")]
    [InlineData("POST", "/api/v1/support/inquiries")]
    [InlineData("POST", "/api/v1/push/devices")]
    [InlineData("POST", "/api/v1/notifications/3/read")]
    [InlineData("POST", "/api/v1/reports")]
    [InlineData("POST", "/api/v1/public-shares/abc/reports")]
    [InlineData("POST", "/api/v1/data-export/downloads")]
    public void ReadsAndTheSafetyAndAccountEndpoints_StayOpen(string method, string path) =>
        Assert.True(AccountRestrictionFilter.IsAllowedWhileRestricted(method, path));

    [Theory]
    [InlineData("POST", "/api/v1/inbox")]
    [InlineData("POST", "/api/v1/items")]
    [InlineData("PUT", "/api/v1/items/5")]
    [InlineData("DELETE", "/api/v1/items/5")]
    [InlineData("POST", "/api/v1/collections")]
    [InlineData("POST", "/api/v1/collections/3/items")]
    [InlineData("POST", "/api/v1/collections/3/items/9/comments")]
    [InlineData("PUT", "/api/v1/collections/3/items/9/reaction")]
    [InlineData("POST", "/api/v1/friends/requests")]
    [InlineData("POST", "/api/v1/public/collections/abc/items")]
    public void EveryContentChange_IsRefused(string method, string path) =>
        Assert.False(AccountRestrictionFilter.IsAllowedWhileRestricted(method, path));

    [Fact]
    public void TheRefusalHasAStableCode() => Assert.Equal("accountRestricted", AccountRestrictionFilter.Code);
}
