using Juple.Application.Push;
using Juple.Domain.Notifications;

namespace Juple.UnitTests.Push;

public sealed class PushNotificationTextGeneratorTests
{
    [Fact]
    public void Generate_WhenLocaleIsKo_ReturnsKoreanTextIncludingProductName()
    {
        var notification = new Notification(
            1, NotificationType.RepeatPurchaseDue, 2, 3, "우유", new DateOnly(2026, 9, 6), DateTimeOffset.UtcNow);

        var (title, body) = PushNotificationTextGenerator.Generate(notification, "ko");

        Assert.Equal("반복 구매 알림", title);
        Assert.Contains("우유", body);
    }

    [Theory]
    [InlineData("en")]
    [InlineData("EN")]
    [InlineData("fr")]
    [InlineData("")]
    public void Generate_WhenLocaleIsNotKo_FallsBackToEnglish(string locale)
    {
        var notification = new Notification(
            1, NotificationType.RepeatPurchaseDue, 2, 3, "Milk", new DateOnly(2026, 9, 6), DateTimeOffset.UtcNow);

        var (title, body) = PushNotificationTextGenerator.Generate(notification, locale);

        Assert.Equal("Repeat purchase reminder", title);
        Assert.Contains("Milk", body);
    }

    [Fact]
    public void Generate_WhenProductNameSnapshotIsNull_UsesGenericBodyWithoutCrashing()
    {
        var notification = new Notification(
            1, NotificationType.RepeatPurchaseDue, 2, null, null, new DateOnly(2026, 9, 6), DateTimeOffset.UtcNow);

        var (_, body) = PushNotificationTextGenerator.Generate(notification, "en");

        Assert.Equal("Time to buy again", body);
    }
}
