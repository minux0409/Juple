namespace Juple.Application.Items;

/// <summary>
/// Single source of truth for the trash's fixed size limits. The server retains up to
/// MaxRetainedPerUser deleted Items per user (see PurgeOldestDeletedBeyondRetentionAsync), while the
/// trash list every user sees is capped to ListLimit - the same for every active user, with no
/// plan/tier distinction (see docs/product-overview.md). Raising the visible list cap deliberately
/// does not change the retention/purge policy.
/// </summary>
public static class ItemTrashLimits
{
    public const int MaxRetainedPerUser = 100;
    public const int ListLimit = 50;
}
