namespace Juple.Application.Push;

public sealed class InvalidPushDeviceRegistrationException(string field, string message) : Exception(message)
{
    public string Field { get; } = field;
}
