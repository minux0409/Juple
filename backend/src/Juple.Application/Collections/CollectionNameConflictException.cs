namespace Juple.Application.Collections;

public sealed class CollectionNameConflictException()
    : Exception("A Collection with this name already exists for this user.");
