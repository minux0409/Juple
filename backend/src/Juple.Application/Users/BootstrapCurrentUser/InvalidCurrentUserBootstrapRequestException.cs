namespace Juple.Application.Users.BootstrapCurrentUser;

public sealed class InvalidCurrentUserBootstrapRequestException(
    string field,
    string message) : Exception(message)
{
    public string Field { get; } = field;
}