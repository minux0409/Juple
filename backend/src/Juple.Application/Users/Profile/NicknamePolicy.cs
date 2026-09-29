using System.Globalization;
using System.Text;
using System.Text.Json;
using Juple.Domain.Users;

namespace Juple.Application.Users.Profile;

/// <summary>The one server-side verdict on a nickname write. Clients map the stable code, never a message.</summary>
public enum NicknameVerdict
{
    Valid,
    TooLong,
    InvalidCharacters,
    Reserved,
    Prohibited,
}

public static class NicknameErrorCodes
{
    public const string TooLong = "nicknameTooLong";
    public const string InvalidCharacters = "nicknameInvalidCharacters";
    public const string Reserved = "nicknameReserved";
    public const string Prohibited = "nicknameProhibited";

    public static string For(NicknameVerdict verdict) => verdict switch
    {
        NicknameVerdict.TooLong => TooLong,
        NicknameVerdict.InvalidCharacters => InvalidCharacters,
        NicknameVerdict.Reserved => Reserved,
        NicknameVerdict.Prohibited => Prohibited,
        _ => throw new ArgumentOutOfRangeException(nameof(verdict), verdict, "Valid has no error code."),
    };
}

/// <summary>
/// Every nickname write (Profile edit, the display-name endpoint - and any future onboarding step)
/// goes through <see cref="Evaluate"/>: first the character/length rules (UserDisplayName), then the
/// reserved and prohibited term lists from NicknameTerms.json. Only applied when a nickname is
/// written - a stored nickname is never re-checked, so tightening the lists never changes, hides or
/// blocks an existing user; they meet the new rules on their next change.
/// </summary>
public static class NicknamePolicy
{
    private static readonly Lazy<NicknameTermList> Terms = new(NicknameTermList.LoadEmbedded);

    /// <param name="normalized">The value to store (NFC, trimmed; null clears the nickname) when Valid.</param>
    public static NicknameVerdict Evaluate(string? input, out string? normalized)
    {
        if (!UserDisplayName.TryNormalize(input, out normalized, out var error))
        {
            return error == UserDisplayNameError.TooLong ? NicknameVerdict.TooLong : NicknameVerdict.InvalidCharacters;
        }

        if (normalized is null)
        {
            return NicknameVerdict.Valid;
        }

        var key = NicknameMatchKey.From(normalized);
        if (key.Length == 0)
        {
            // Nothing but symbols/emoji/punctuation - allowed ("🌻", "^^"), nothing to match.
            return NicknameVerdict.Valid;
        }

        var terms = Terms.Value;
        if (terms.Reserved.Matches(key))
        {
            normalized = null;
            return NicknameVerdict.Reserved;
        }

        if (terms.Prohibited.Matches(key))
        {
            normalized = null;
            return NicknameVerdict.Prohibited;
        }

        return NicknameVerdict.Valid;
    }
}

/// <summary>
/// The comparison form shared by nicknames and terms: compatibility-decomposed (full-width and
/// styled letters become plain ones), lowercased, only letters and digits kept (spaces,
/// punctuation, symbols, emoji and accents dropped - so "J U P L E", "juple.official" and "Júple"
/// meet "juple"), then recomposed so Hangul compares by syllable. Deliberately no look-alike
/// (confusable) or leetspeak mapping: those block ordinary names far more often than they catch
/// abuse at this list size.
/// </summary>
public static class NicknameMatchKey
{
    public static string From(string value)
    {
        var decomposed = value.Normalize(NormalizationForm.FormKD);
        var builder = new StringBuilder(decomposed.Length);
        foreach (var rune in decomposed.EnumerateRunes())
        {
            if (Rune.IsLetterOrDigit(rune))
            {
                builder.Append(Rune.ToLowerInvariant(rune).ToString());
            }
        }

        return builder.ToString().Normalize(NormalizationForm.FormC);
    }
}

/// <summary>One list's exact and contains rules, already reduced to match keys.</summary>
public sealed class NicknameTermRules(IReadOnlyCollection<string> exact, IReadOnlyCollection<string> contains)
{
    private readonly HashSet<string> exact = new(exact, StringComparer.Ordinal);

    public bool Matches(string key) =>
        exact.Contains(key) || contains.Any(term => key.Contains(term, StringComparison.Ordinal));
}

public sealed class NicknameTermList(NicknameTermRules reserved, NicknameTermRules prohibited)
{
    public const string ResourceName = "Juple.Application.Users.Profile.NicknameTerms.json";

    public NicknameTermRules Reserved { get; } = reserved;

    public NicknameTermRules Prohibited { get; } = prohibited;

    public static NicknameTermList LoadEmbedded()
    {
        using var stream = typeof(NicknameTermList).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} is missing.");
        return Parse(stream);
    }

    /// <summary>Fails loudly on a malformed list or a term that reduces to nothing - never silently skips a rule.</summary>
    public static NicknameTermList Parse(Stream json)
    {
        using var document = JsonDocument.Parse(json);
        return new NicknameTermList(
            ReadRules(document.RootElement, "reserved"),
            ReadRules(document.RootElement, "prohibited"));
    }

    private static NicknameTermRules ReadRules(JsonElement root, string listName)
    {
        var list = root.GetProperty(listName);
        return new NicknameTermRules(ReadKeys(list, listName, "exact"), ReadKeys(list, listName, "contains"));
    }

    private static List<string> ReadKeys(JsonElement list, string listName, string ruleName)
    {
        var keys = new List<string>();
        foreach (var term in list.GetProperty(ruleName).EnumerateArray())
        {
            var key = NicknameMatchKey.From(term.GetString() ?? string.Empty);
            if (key.Length == 0)
            {
                throw new InvalidOperationException(
                    string.Create(CultureInfo.InvariantCulture, $"Nickname term '{term}' in {listName}.{ruleName} has no letters or digits."));
            }

            keys.Add(key);
        }

        return keys;
    }
}
