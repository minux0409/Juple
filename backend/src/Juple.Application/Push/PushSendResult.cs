using Juple.Domain.Notifications;

namespace Juple.Application.Push;

public sealed record PushSendResult(NotificationDeliveryStatus Status, string? ProviderMessageId, string? FailureCode)
{
    public static PushSendResult Sent(string? providerMessageId) =>
        new(NotificationDeliveryStatus.Sent, providerMessageId, null);

    public static PushSendResult Failed(string failureCode) =>
        new(NotificationDeliveryStatus.Failed, null, failureCode);
}
