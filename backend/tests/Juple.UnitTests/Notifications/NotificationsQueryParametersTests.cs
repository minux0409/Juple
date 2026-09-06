using Juple.Api.Notifications;

namespace Juple.UnitTests.Notifications;

public sealed class NotificationsQueryParametersTests
{
    [Fact]
    public void TryParseLimit_WhenAbsent_ReturnsDefaultLimit()
    {
        var parsed = NotificationsQueryParameters.TryParseLimit(null, out var limit);

        Assert.True(parsed);
        Assert.Equal(NotificationsQueryParameters.DefaultLimit, limit);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(100)]
    [InlineData(50)]
    public void TryParseLimit_WhenWithinRange_ReturnsThatLimit(int value)
    {
        var parsed = NotificationsQueryParameters.TryParseLimit(value, out var limit);

        Assert.True(parsed);
        Assert.Equal(value, limit);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(101)]
    public void TryParseLimit_WhenOutOfRange_ReturnsFalse(int value)
    {
        var parsed = NotificationsQueryParameters.TryParseLimit(value, out _);

        Assert.False(parsed);
    }
}
