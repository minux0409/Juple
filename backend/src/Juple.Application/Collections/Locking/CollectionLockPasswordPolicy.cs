namespace Juple.Application.Collections.Locking;

/// <summary>
/// A lock password guards content that may be reachable from the open web (a public share link),
/// so a 4-digit PIN is not accepted: at least 6 characters. No character-class rules beyond that.
/// </summary>
public static class CollectionLockPasswordPolicy
{
    public const int MinLength = 6;
    public const int MaxLength = 64;

    public static string Validate(string? password, string field = "password")
    {
        if (string.IsNullOrWhiteSpace(password) || password.Length < MinLength || password.Length > MaxLength)
        {
            throw new InvalidCollectionException(
                field, $"A password of {MinLength} to {MaxLength} characters is required.");
        }

        return password;
    }
}
