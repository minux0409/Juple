using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.NotificationPreference;

/// <summary>The caller's own 새 링크 알림 setting for one Collection (ON unless they turned it off).</summary>
public sealed record CollectionNotificationPreferenceDto(bool NewItemNotificationsEnabled);

public interface ICollectionNotificationPreferenceStore
{
    /// <summary>The stored choice, or null when this user never changed it (the default: ON).</summary>
    Task<bool?> FindNewItemNotificationsAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    /// <summary>Upsert of this user's own row - race-safe on (CollectionId, UserId).</summary>
    Task SetNewItemNotificationsAsync(long userId, long collectionId, bool enabled, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default);
}

public interface ICollectionNotificationPreferenceService
{
    Task<CollectionNotificationPreferenceDto> GetAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    Task<CollectionNotificationPreferenceDto> SetAsync(long userId, long collectionId, bool newItemNotificationsEnabled, CancellationToken cancellationToken = default);
}

/// <summary>
/// Each participant's own setting - the Owner and every accepted member (Contributor or Viewer)
/// alike; nobody can read or change anyone else's (the user id only ever comes from the signed-in
/// caller). No access is the same 404 as a missing Collection. Not gated by the lock or the share
/// password: like the favorite mark, it reveals nothing of the content.
/// </summary>
public sealed class CollectionNotificationPreferenceService(
    ICollectionAccessService accessService,
    ICollectionNotificationPreferenceStore store,
    TimeProvider timeProvider) : ICollectionNotificationPreferenceService
{
    public async Task<CollectionNotificationPreferenceDto> GetAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.View, cancellationToken);
        var stored = await store.FindNewItemNotificationsAsync(userId, collectionId, cancellationToken);
        return new CollectionNotificationPreferenceDto(stored ?? true);
    }

    public async Task<CollectionNotificationPreferenceDto> SetAsync(
        long userId, long collectionId, bool newItemNotificationsEnabled, CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.View, cancellationToken);
        await store.SetNewItemNotificationsAsync(userId, collectionId, newItemNotificationsEnabled, timeProvider.GetUtcNow(), cancellationToken);
        return new CollectionNotificationPreferenceDto(newItemNotificationsEnabled);
    }
}
