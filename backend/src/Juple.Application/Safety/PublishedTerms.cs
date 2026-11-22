using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Juple.Application.Safety;

/// <summary>Only an existing published document belongs here. Legal drafts are never loaded at runtime.</summary>
public static class PublishedTerms
{
    private static readonly JsonElement Source = Load();
    public static string Version => Source.GetProperty("version").GetString()!;
    public static string ContentHash => Source.GetProperty("contentHash").GetString()!;

    public static bool Matches(string? version, string? contentHash, string? requestedLanguage) =>
        string.Equals(version, Version, StringComparison.Ordinal)
        && string.Equals(contentHash, ContentHash, StringComparison.Ordinal)
        && Source.GetProperty("consentLanguages").EnumerateArray().Any(item => item.GetString() == requestedLanguage);

    public static object? GetDocument(string version, string? language)
    {
        if (version != Version) return null;
        var requested = language ?? "ko";
        if (!Source.GetProperty("supportedLanguages").EnumerateArray().Any(item => item.GetString() == requested)) return null;
        // The existing public full agreement is Korean. This is an explicit fallback, NOT approval of translations.
        var canAccept = Source.GetProperty("consentLanguages").EnumerateArray().Any(item => item.GetString() == requested);
        return new { version = Version, language = "ko", requestedLanguage = requested, canAccept,
            contentHash = ContentHash, document = Source.GetProperty("document") };
    }

    private static JsonElement Load()
    {
        using var stream = typeof(PublishedTerms).Assembly.GetManifestResourceStream("Juple.Application.Safety.PublishedTerms.json")!;
        using var json = JsonDocument.Parse(stream);
        var source = json.RootElement.Clone();
        var document = source.GetProperty("document");
        if (source.GetProperty("version").GetString() != document.GetProperty("updated").GetString())
            throw new InvalidOperationException("Published terms version and document revision must match.");
        var parts = new List<string> { document.GetProperty("title").GetString()!, document.GetProperty("intro").GetString()! };
        foreach (var section in document.GetProperty("sections").EnumerateArray())
        {
            parts.Add(section.GetProperty("title").GetString()!);
            foreach (var block in section.GetProperty("blocks").EnumerateArray())
            {
                if (block.GetProperty("kind").GetString() == "p") parts.Add(block.GetProperty("text").GetString()!);
                else parts.AddRange(block.GetProperty("items").EnumerateArray().Select(item => item.GetString()!));
            }
        }
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", parts))));
        if (hash != source.GetProperty("contentHash").GetString()) throw new InvalidOperationException("Published terms content hash mismatch.");
        return source;
    }
}
