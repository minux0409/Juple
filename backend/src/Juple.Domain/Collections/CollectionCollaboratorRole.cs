namespace Juple.Domain.Collections;

/// <summary>
/// A non-owner member's role in a Collection. The Owner is never a collaborator row - ownership is
/// Collection.UserId alone. Persisted as its name (string), never its ordinal, so adding a role
/// cannot change the meaning of stored rows.
/// </summary>
public enum CollectionCollaboratorRole
{
    /// <summary>Views the Collection and its links, and adds their own links (공동작업).</summary>
    Contributor,

    /// <summary>Views the Collection and its links only (보기 전용 공유) - never adds or changes anything.</summary>
    Viewer,
}
