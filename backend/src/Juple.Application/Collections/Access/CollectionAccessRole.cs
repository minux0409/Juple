namespace Juple.Application.Collections.Access;

/// <summary>The caller's relationship to an active Collection. "No access" is represented by the absence of a CollectionAccess.</summary>
public enum CollectionAccessRole
{
    Owner,
    Contributor,
    Viewer,

    /// <summary>승인 후 추가 - a Viewer who may also propose links for the Owner to approve.</summary>
    Submitter,
}
