using System.Text;

namespace Juple.Application.Collections.SharePassword;

/// <summary>
/// A share password guards access to something already shared - not an account - so the rules stay
/// simple: 4 to 64 characters after Unicode NFC normalization, no control characters, and no
/// leading or trailing whitespace (rejected, not silently trimmed, so what the Owner typed is exactly
/// what recipients must type). No strength rules. Attempts are normalized the same way, so a
/// composed and a decomposed spelling of the same text always match.
/// </summary>
public static class CollectionSharePasswordPolicy
{
    public const int MinLength = 4;
    public const int MaxLength = 64;

    public static string Validate(string? password, string field = "password")
    {
        var normalized = Normalize(password);
        if (normalized is null
            || normalized.Length < MinLength
            || normalized.Length > MaxLength
            || normalized.Any(char.IsControl)
            || normalized.Trim().Length != normalized.Length)
        {
            throw new InvalidCollectionException(
                field, $"A share password of {MinLength} to {MaxLength} characters, without control characters or surrounding spaces, is required.");
        }

        return normalized;
    }

    /// <summary>NFC-normalizes an attempt (null for nothing, or for text that cannot be normalized).</summary>
    public static string? Normalize(string? password)
    {
        if (string.IsNullOrEmpty(password))
        {
            return null;
        }

        try
        {
            return password.Normalize(NormalizationForm.FormC);
        }
        catch (ArgumentException)
        {
            // Ill-formed UTF-16 (a lone surrogate): never a valid password.
            return null;
        }
    }
}
