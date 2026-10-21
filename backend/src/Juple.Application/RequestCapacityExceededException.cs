namespace Juple.Application;

/// <summary>Local, bounded work admission refused before an expensive operation starts.</summary>
public sealed class RequestCapacityExceededException : Exception
{
    public RequestCapacityExceededException() : base("Request capacity is temporarily exhausted.") { }
}
