namespace Juple.Domain.Collections;

/// <summary>
/// One user's own notification choice for one Collection they own or are a member of. Strictly per
/// user - the Owner and every member each have their own. No row means the default: new-link
/// notifications ON. A row is written only once the user changes the setting.
/// </summary>
public sealed class CollectionNotificationPreference
{
    private CollectionNotificationPreference()
    {
    }

    public CollectionNotificationPreference(long collectionId, long userId, bool newItemNotificationsEnabled, DateTimeOffset updatedAtUtc)
    {
        CollectionId = collectionId;
        UserId = userId;
        NewItemNotificationsEnabled = newItemNotificationsEnabled;
        UpdatedAtUtc = updatedAtUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long UserId { get; private set; }

    public bool NewItemNotificationsEnabled { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public void SetNewItemNotifications(bool enabled, DateTimeOffset updatedAtUtc)
    {
        NewItemNotificationsEnabled = enabled;
        UpdatedAtUtc = updatedAtUtc;
    }
}
