using Juple.Application.Collections.Locking;
using Juple.Domain.Collections;

namespace Juple.Application.Collections.Public;

/// <summary>What a public-link visitor must prove before seeing (or adding to) the Collection.</summary>
public enum PublicShareRequirement
{
    None,

    /// <summary>A legacy Collection that is locked: its Owner's lock password, as before share passwords.</summary>
    LockPassword,

    /// <summary>The Collection's own share password.</summary>
    SharePassword,
}

/// <summary>
/// The one public-link content gate - reading the page, its items and adding through a writable
/// link all go through it. A link visitor is a recipient like any member: the Collection's own share
/// password when it has one; the Owner's lock password only for a legacy Collection that is locked;
/// otherwise nothing. Proving it never widens the link's permission (a read-only link stays
/// read-only, and adding still needs a signed-in account).
/// </summary>
public static class PublicShareGate
{
    public static PublicShareRequirement RequirementOf(PublicShareState state) => state.SharePasswordMode switch
    {
        CollectionSharePasswordMode.PerCollection => PublicShareRequirement.SharePassword,
        CollectionSharePasswordMode.LegacyCommonLock when state.IsLocked => PublicShareRequirement.LockPassword,
        _ => PublicShareRequirement.None,
    };

    public static bool IsUnlocked(
        PublicShareState state,
        string? unlockToken,
        ICollectionUnlockTokenProtector unlockTokenProtector,
        DateTimeOffset nowUtc)
    {
        var subject = CollectionUnlockSubject.ForPublicShare(state.ShareId);
        return RequirementOf(state) switch
        {
            PublicShareRequirement.LockPassword => unlockTokenProtector.IsValid(
                unlockToken, state.CollectionId, subject, state.LockVersion, nowUtc),
            PublicShareRequirement.SharePassword => unlockTokenProtector.IsValid(
                unlockToken, state.CollectionId, subject, state.SharePasswordVersion, nowUtc, CollectionUnlockPurpose.SharePassword),
            _ => true,
        };
    }
}
