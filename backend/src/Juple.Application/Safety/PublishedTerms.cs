using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Juple.Application.Safety;

/// <summary>Only an existing published document belongs here. Legal drafts are never loaded at runtime.</summary>
public static class PublishedTerms
{
    private static readonly JsonElement Source = Load("PublishedTerms.json");
    private static readonly JsonElement LegacySource = Load("LegacyPublishedTerms.json");
    // Public versions that were in force before the current one: kept readable (the page and GET .../terms/document), never accepted.
    // Replacing the current document moves it here, so no published text disappears when a new version takes effect.
    private static readonly IReadOnlyList<JsonElement> Archived = LoadArchive("ArchivedPublishedTerms.json", Source, LegacySource);
    public static string Version => Source.GetProperty("version").GetString()!;
    public static string ContentHash => Source.GetProperty("contentHash").GetString()!;

    // Only these two can ever be agreed to; an archived version is a record of what applied before, not something to consent to now.
    private static JsonElement? FindAcceptable(string? version) =>
        version == Version ? Source : version == LegacySource.GetProperty("version").GetString() ? LegacySource : null;

    internal static JsonElement? FindReadable(string? version, IReadOnlyList<JsonElement> archived) =>
        FindAcceptable(version) ?? archived.Cast<JsonElement?>().FirstOrDefault(item => item!.Value.GetProperty("version").GetString() == version);

    // This exception is tied to the recovered historical document, never to an operator-selected future version.
    public static bool AllowsLegacyRequest(string? version) => version == LegacySource.GetProperty("version").GetString();

    public static bool Matches(string? version, string? contentHash, string? requestedLanguage)
    {
        if (FindAcceptable(version) is not { } source || requestedLanguage is null
            || !source.GetProperty("supportedLanguages").EnumerateArray().Any(x => x.GetString() == requestedLanguage)) return false;
        var selected = SelectSource(source, requestedLanguage);
        return selected.GetProperty("language").GetString() == requestedLanguage
            && selected.GetProperty("contentHash").GetString() == contentHash
            && (selected.GetProperty("language").GetString() != source.GetProperty("language").GetString()
                || source.GetProperty("consentLanguages").EnumerateArray().Any(item => item.GetString() == requestedLanguage));
    }

    // Approval is explicit per version/language; a draft's presence never authorizes publication.
    internal static JsonElement SelectSource(JsonElement source, string language)
    {
        if (language == source.GetProperty("language").GetString()) return source;
        if (!source.TryGetProperty("approvedTranslations", out var translations)) return source;
        var matches = translations.EnumerateArray().Where(t => t.GetProperty("language").GetString() == language
            && t.GetProperty("version").GetString() == source.GetProperty("version").GetString()).ToArray();
        if (matches.Length != 1) return source;
        var translated = matches[0];
        if (!translated.TryGetProperty("approval", out var approval)
            || approval.GetProperty("status").GetString() != "approved"
            || string.IsNullOrWhiteSpace(approval.GetProperty("legalReview").GetString())
            || string.IsNullOrWhiteSpace(approval.GetProperty("languageReview").GetString())) return source;
        if (translated.GetProperty("sourceContentHash").GetString() != source.GetProperty("contentHash").GetString()) return source;
        Validate(translated);
        return translated;
    }

    public static object? GetDocument(string version, string? language) => GetDocument(version, language, Archived);

    internal static object? GetDocument(string version, string? language, IReadOnlyList<JsonElement> archived)
    {
        if (FindReadable(version, archived) is not { } source) return null;
        var requested = language ?? "ko";
        if (!source.GetProperty("supportedLanguages").EnumerateArray().Any(item => item.GetString() == requested)) return null;
        // The existing public full agreement is Korean. This is an explicit fallback, NOT approval of translations.
        var selected = SelectSource(source, requested);
        var canAccept = Matches(version, selected.GetProperty("contentHash").GetString(), requested);
        return new { version, language = selected.GetProperty("language").GetString(), requestedLanguage = requested, canAccept,
            contentHash = selected.GetProperty("contentHash").GetString(), document = selected.GetProperty("document") };
    }

    private static JsonElement Load(string name)
    {
        using var stream = typeof(PublishedTerms).Assembly.GetManifestResourceStream($"Juple.Application.Safety.{name}")!;
        using var json = JsonDocument.Parse(stream);
        return ValidateWithTranslations(json.RootElement.Clone());
    }

    private static IReadOnlyList<JsonElement> LoadArchive(string name, params JsonElement[] inForce)
    {
        using var stream = typeof(PublishedTerms).Assembly.GetManifestResourceStream($"Juple.Application.Safety.{name}")!;
        using var json = JsonDocument.Parse(stream);
        return ValidateArchive(json.RootElement.Clone(), inForce);
    }

    /// <summary>Each archived version is checked like the current one (revision, hash, translations); a version may appear only once.</summary>
    internal static IReadOnlyList<JsonElement> ValidateArchive(JsonElement archive, params JsonElement[] inForce)
    {
        var seen = new HashSet<string>(inForce.Select(item => item.GetProperty("version").GetString()!), StringComparer.Ordinal);
        var result = new List<JsonElement>();
        foreach (var item in archive.EnumerateArray())
        {
            if (!seen.Add(ValidateWithTranslations(item).GetProperty("version").GetString()!))
                throw new InvalidOperationException("A terms version may be published only once.");
            result.Add(item);
        }
        return result;
    }

    private static JsonElement ValidateWithTranslations(JsonElement source)
    {
        Validate(source);
        if (source.TryGetProperty("approvedTranslations", out var translations))
            foreach (var translation in translations.EnumerateArray())
                _ = SelectSource(source, translation.GetProperty("language").GetString()!);
        return source;
    }

    private static void Validate(JsonElement source)
    {
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
    }
}
