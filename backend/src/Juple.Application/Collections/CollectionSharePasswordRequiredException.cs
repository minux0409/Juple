namespace Juple.Application.Collections;

/// <summary>
/// The caller has access to this shared Collection (a member, or a live public link), but it is
/// protected by its own share password and no valid share-password grant was presented - no content
/// may be returned. Never raised for the Owner.
/// </summary>
public sealed class CollectionSharePasswordRequiredException : Exception
{
}
