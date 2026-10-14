namespace Juple.Application.Users.BootstrapCurrentUser;

public sealed class InvalidCurrentUserBootstrapRequestException(
    string field,
    string message) : Exception(message)
{
    public string Field { get; } = field;
}

/// <summary>The identity's previous account is still being deleted (its sign-in account is not gone yet); try again shortly.</summary>
public sealed class AccountDeletionPendingException() : Exception("The previous account of this sign-in is still being deleted.");
