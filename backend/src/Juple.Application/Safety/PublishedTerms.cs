using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Juple.Application.Safety;

/// <summary>Only an existing published document belongs here. Legal drafts are never loaded at runtime.</summary>
public static class PublishedTerms
{
    private static readonly JsonElement Source = Load("PublishedTerms.json");
    private static readonly JsonElement LegacySource = Load("LegacyPublishedTerms.json");
    public static string Version => Source.GetProperty("version").GetString()!;
    public static string ContentHash => Source.GetProperty("contentHash").GetString()!;

    private static JsonElement? Find(string? version) =>
        version == Version ? Source : version == LegacySource.GetProperty("version").GetString() ? LegacySource : null;

    // This exception is tied to the recovered historical document, never to an operator-selected future version.
    public static bool AllowsLegacyRequest(string? version) => version == LegacySource.GetProperty("version").GetString();

    public static bool Matches(string? version, string? contentHash, string? requestedLanguage) =>
        Find(version) is { } source
        && string.Equals(contentHash, source.GetProperty("contentHash").GetString(), StringComparison.Ordinal)
        && source.GetProperty("consentLanguages").EnumerateArray().Any(item => item.GetString() == requestedLanguage);

    public static object? GetDocument(string version, string? language)
    {
        if (Find(version) is not { } source) return null;
        var requested = language ?? "ko";
        if (!source.GetProperty("supportedLanguages").EnumerateArray().Any(item => item.GetString() == requested)) return null;
        // The existing public full agreement is Korean. This is an explicit fallback, NOT approval of translations.
        var canAccept = source.GetProperty("consentLanguages").EnumerateArray().Any(item => item.GetString() == requested);
        return new { version, language = source.GetProperty("language").GetString(), requestedLanguage = requested, canAccept,
            contentHash = source.GetProperty("contentHash").GetString(), document = source.GetProperty("document") };
    }

    private static JsonElement Load(string name)
    {
        using var stream = typeof(PublishedTerms).Assembly.GetManifestResourceStream($"Juple.Application.Safety.{name}")!;
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
