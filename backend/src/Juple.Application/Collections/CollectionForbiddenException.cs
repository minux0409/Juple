namespace Juple.Application.Collections;

/// <summary>The caller can see this Collection but their role does not allow the operation (403, never 404).</summary>
public sealed class CollectionForbiddenException : Exception
{
}
