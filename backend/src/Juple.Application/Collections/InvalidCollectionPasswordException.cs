namespace Juple.Application.Collections;

/// <summary>Wrong lock password. Deliberately carries no detail (no hint about length, attempts left, etc.).</summary>
public sealed class InvalidCollectionPasswordException : Exception
{
}
