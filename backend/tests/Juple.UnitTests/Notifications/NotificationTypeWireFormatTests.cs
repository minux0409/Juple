using Juple.Api.Notifications;
using Juple.Domain.Notifications;

namespace Juple.UnitTests.Notifications;

public sealed class NotificationTypeWireFormatTests
{
    [Fact]
    public void ToWireValue_RepeatPurchaseDue_ReturnsLowerCamelCaseValue()
    {
        Assert.Equal("repeatPurchaseDue", NotificationTypeWireFormat.ToWireValue(NotificationType.RepeatPurchaseDue));
    }

    [Fact]
    public void ToWireValue_UnknownType_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => NotificationTypeWireFormat.ToWireValue((NotificationType)255));
    }
}
