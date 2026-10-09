namespace Juple.Application.Collections.Public;

/// <summary>
/// What a SIGNED-IN user is, relative to the Collection behind a public share link. CollectionId and Role are filled only for
/// someone who is already the Owner or an accepted member. A non-member learns only whether the link's contents are public (IsPublic:
/// false = a private link that only offers a join request) and whether THEIR OWN join request is waiting - nothing else, never an internal id.
/// </summary>
public sealed record PublicShareMembershipDto(
    bool IsMember,
    long? CollectionId,
    string? Role,
    bool IsPublic = true,
    bool JoinRequestPending = false);

public interface IPublicShareMembershipStore
{
    /// <summary>Null for an unknown / revoked link or a deleted Collection (the same indistinguishable "unavailable" as every public read).</summary>
    Task<PublicShareMembershipDto?> GetAsync(string publicId, long userId, CancellationToken cancellationToken = default);
}
