namespace Juple.Application.Collections;

/// <summary>The Collection is locked and no valid unlock grant was presented - no content may be returned.</summary>
public sealed class CollectionLockedException : Exception
{
}
