using Juple.Domain.Notifications;

namespace Juple.Application.Push;

/// <summary>
/// Generates the visible title/body for a Notification's Push message, keyed by the *device
/// registration's* Locale - never Users.PreferredLocale (see PushDeviceRegistration.Locale's own
/// remarks on why). Mirrors Mobile's notifications.repeatPurchaseDueFallbackTitle/repeatPurchaseDueMessage
/// i18n strings (apps/mobile/src/i18n/locales/{ko,en}.json) so the push notification's wording
/// matches what the in-app Notification Center already shows for the same event. Only "ko" gets the
/// Korean strings; every other locale (including unrecognized ones) safely falls back to English -
/// this is a fixed, small, generated-server-side set of strings, never arbitrary user text, so a
/// missing locale is a silent fallback, not a data-loss risk.
/// </summary>
public static class PushNotificationTextGenerator
{
    public static (string Title, string Body) Generate(Notification notification, string locale)
    {
        var isKorean = string.Equals(locale, "ko", StringComparison.OrdinalIgnoreCase);
        var productName = notification.ProductNameSnapshot;

        if (isKorean)
        {
            var body = string.IsNullOrEmpty(productName)
                ? "구매하실 때가 되었어요"
                : $"{productName} 구매하실 때가 되었어요";
            return ("반복 구매 알림", body);
        }

        var englishBody = string.IsNullOrEmpty(productName)
            ? "Time to buy again"
            : $"Time to buy {productName} again";
        return ("Repeat purchase reminder", englishBody);
    }
}
