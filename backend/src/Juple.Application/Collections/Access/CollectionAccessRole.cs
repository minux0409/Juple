namespace Juple.Application.Collections.Access;

/// <summary>The caller's relationship to an active Collection. "No access" is represented by the absence of a CollectionAccess.</summary>
public enum CollectionAccessRole
{
    Owner,
    Contributor,
    Viewer,
}
