using System.Security.Cryptography;

namespace Juple.Domain.Users;

/// <summary>
/// The user-facing "Juple ID" - a short, random, public identifier a person can read out or type to
/// be found for a Collection invitation. It is deliberately unrelated to the internal UserId (never
/// derived from it, never sequential) and carries no personal data (not an email, not a name).
///
/// Format: <see cref="Length"/> characters from <see cref="Alphabet"/> - uppercase letters and
/// digits minus the easily-confused 0/O and 1/I/L - stored canonical (uppercase, no separator).
/// 31^8 ≈ 8.5 × 10^11 possible codes, drawn with a CSPRNG and rejection sampling (no modulo bias).
/// The same alphabet/length is used by the migration's T-SQL backfill for pre-existing users.
/// </summary>
public static class UserPublicCode
{
    public const string Alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

    public const int Length = 8;

    // Largest multiple of Alphabet.Length that fits in a byte (8 × 31 = 248): bytes at or above it
    // are discarded so every character is equally likely.
    private const int RejectionThreshold = 256 - (256 % 31);

    public static string Generate()
    {
        Span<char> code = stackalloc char[Length];
        Span<byte> buffer = stackalloc byte[16];
        var filled = 0;
        while (filled < Length)
        {
            RandomNumberGenerator.Fill(buffer);
            foreach (var value in buffer)
            {
                if (value >= RejectionThreshold)
                {
                    continue;
                }

                code[filled++] = Alphabet[value % Alphabet.Length];
                if (filled == Length)
                {
                    break;
                }
            }
        }

        return new string(code);
    }

    /// <summary>
    /// Canonicalizes user input for an exact lookup: trims, uppercases, and drops the display
    /// separator/whitespace ("k7mp-4q8n" → "K7MP4Q8N"). Returns false for anything that cannot be a
    /// Juple ID (wrong length, a character outside the alphabet) - such input is never looked up.
    /// </summary>
    public static bool TryNormalize(string? input, out string code)
    {
        code = string.Empty;
        if (string.IsNullOrWhiteSpace(input) || input.Length > 32)
        {
            return false;
        }

        Span<char> buffer = stackalloc char[Length];
        var count = 0;
        foreach (var raw in input)
        {
            if (raw is '-' or ' ')
            {
                continue;
            }

            var character = char.ToUpperInvariant(raw);
            if (count == Length || Alphabet.IndexOf(character) < 0)
            {
                return false;
            }

            buffer[count++] = character;
        }

        if (count != Length)
        {
            return false;
        }

        code = new string(buffer);
        return true;
    }
}
