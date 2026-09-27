namespace Juple.Application.Collections.Collaboration;

/// <summary>No user has this Juple ID (404) - the same response whether the input was well-formed or not.</summary>
public sealed class JupleIdNotFoundException : Exception
{
}

/// <summary>
/// No invitation with this id addressed to the caller (404) - an invitation addressed to someone
/// else is indistinguishable from a non-existent one, so forwarding an id grants nothing.
/// </summary>
public sealed class CollectionInvitationNotFoundException : Exception
{
}

/// <summary>That person is not a collaborator of this Collection (404).</summary>
public sealed class CollectionCollaboratorNotFoundException : Exception
{
}
