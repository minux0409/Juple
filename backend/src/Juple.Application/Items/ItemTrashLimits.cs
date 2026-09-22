namespace Juple.Application.Items;

/// <summary>
/// Single source of truth for the trash's fixed size limits. The server always retains up to
/// MaxRetainedPerUser deleted Items per user regardless of Plan (see
/// PurgeOldestDeletedBeyondRetentionAsync) - so a Free user who upgrades to Plus can still recover
/// items they deleted while on Free - but a Free-plan trash list is capped to FreeListLimit; only
/// Plus can see/restore beyond that, up to the same MaxRetainedPerUser the server already kept.
/// </summary>
public static class ItemTrashLimits
{
    public const int MaxRetainedPerUser = 100;
    public const int FreeListLimit = 10;
    public const int PlusListLimit = MaxRetainedPerUser;
}
