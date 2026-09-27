namespace Juple.Domain.Collections;

/// <summary>Persisted as its name (string), never its ordinal.</summary>
public enum CollectionInvitationStatus
{
    Pending,
    Accepted,
    Declined,
    Revoked,
    Expired,
}
