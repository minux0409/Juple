namespace Juple.Application.Translation;

/// <summary>
/// The "Translation" configuration section. Provider "None" (the default) means no machine translation exists at all: every
/// translate request answers translationNotConfigured and nothing is ever marked as translated. "AzureAITranslator" uses the
/// Azure AI Translator text API (key + region from configuration - a Key Vault reference when deployed, never source).
/// Inquiry text written by users is personal data and leaves Juple only when AllowInquiryTranslation is ALSO true, which must
/// not be switched on before the privacy notice names the translation processor (docs/admin.md, "Translation").
/// </summary>
public sealed class TranslationOptions
{
    public const string SectionName = "Translation";
    public const string ProviderNone = "None";
    public const string ProviderAzure = "AzureAITranslator";

    public string Provider { get; set; } = ProviderNone;

    public bool AllowInquiryTranslation { get; set; }

    public AzureTranslatorOptions AzureTranslator { get; set; } = new();

    public bool IsAzure => string.Equals(Provider, ProviderAzure, StringComparison.Ordinal);

    /// <summary>The first problem with the configuration, or null (the API refuses to start on a contradictory one).</summary>
    public string? Validate()
    {
        if (!string.Equals(Provider, ProviderNone, StringComparison.Ordinal) && !IsAzure)
        {
            return $"Translation:Provider must be {ProviderNone} or {ProviderAzure}.";
        }

        if (!IsAzure)
        {
            return AllowInquiryTranslation ? "Translation:AllowInquiryTranslation requires a configured provider." : null;
        }

        if (string.IsNullOrWhiteSpace(AzureTranslator.Key) || string.IsNullOrWhiteSpace(AzureTranslator.Region))
        {
            return "Translation:AzureTranslator:Key and :Region are required for the AzureAITranslator provider.";
        }

        return Uri.TryCreate(AzureTranslator.Endpoint, UriKind.Absolute, out var endpoint) && endpoint.Scheme == Uri.UriSchemeHttps
            ? null
            : "Translation:AzureTranslator:Endpoint must be an absolute https URL.";
    }
}

public sealed class AzureTranslatorOptions
{
    public string Endpoint { get; set; } = "https://api.cognitive.microsofttranslator.com";

    public string? Region { get; set; }

    public string? Key { get; set; }
}

/// <summary>
/// The languages Juple ships (the mobile i18n locale files, the Web, notices). Korean is the operators' language and every
/// notice's source. One list for every translation feature - never a shorter, hand-picked one.
/// </summary>
public static class TranslationLanguages
{
    public const string Korean = "ko";

    public static readonly IReadOnlyList<string> Supported =
        ["ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "fr", "de", "it", "pt-BR", "vi", "th", "id", "ru", "tr", "ar", "hi"];

    public static bool IsSupported(string? value) => value is not null && Supported.Contains(value, StringComparer.Ordinal);

    /// <summary>
    /// A device locale ("pt-PT", "zh-Hant-TW", "zh-CN", "en_US") as one of the supported languages, or null when none fits. Exact
    /// match first, then the script / region rules for Chinese and Portuguese, then the primary language subtag.
    /// </summary>
    public static string? FromLocale(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
        {
            return null;
        }

        var tag = locale.Trim().Replace('_', '-');
        var exact = Supported.FirstOrDefault(language => string.Equals(language, tag, StringComparison.OrdinalIgnoreCase));
        if (exact is not null)
        {
            return exact;
        }

        var parts = tag.Split('-', StringSplitOptions.RemoveEmptyEntries);
        var primary = parts.Length > 0 ? parts[0].ToLowerInvariant() : string.Empty;
        if (primary == "zh")
        {
            var rest = parts.Skip(1).Select(part => part.ToUpperInvariant()).ToArray();
            return rest.Contains("HANT") || rest.Contains("TW") || rest.Contains("HK") || rest.Contains("MO") ? "zh-Hant" : "zh-Hans";
        }

        if (primary == "pt")
        {
            return "pt-BR";
        }

        return Supported.FirstOrDefault(language => language == primary);
    }
}

/// <summary>Texts in one request are translated together (a title and its body); the order of the result is the order given.</summary>
public sealed record TranslationRequest(IReadOnlyList<string> Texts, string? SourceLanguage, string TargetLanguage);

/// <summary>DetectedLanguage is the provider's guess when no source language was given (a supported code, or the provider's raw code).</summary>
public sealed record TranslationResult(IReadOnlyList<string> Texts, string? DetectedLanguage);

/// <summary>
/// Why nothing was translated: notConfigured (no provider), inquiryTranslationNotAllowed, providerRejected (credentials or
/// quota), throttled, unavailable, timeout, invalidResponse, tooLong. Never a translation that did not happen.
/// </summary>
public sealed class TranslationUnavailableException(string code) : Exception($"Translation unavailable: {code}")
{
    public string Code { get; } = code;
}

public interface ITextTranslator
{
    /// <summary>"None" or the provider's name, for the Admin Web's status line.</summary>
    string ProviderName { get; }

    bool IsConfigured { get; }

    Task<TranslationResult> TranslateAsync(TranslationRequest request, CancellationToken cancellationToken = default);
}

/// <summary>Provider "None": nothing is sent anywhere and every request is refused as notConfigured.</summary>
public sealed class DisabledTextTranslator : ITextTranslator
{
    public string ProviderName => TranslationOptions.ProviderNone;

    public bool IsConfigured => false;

    public Task<TranslationResult> TranslateAsync(TranslationRequest request, CancellationToken cancellationToken = default) =>
        throw new TranslationUnavailableException("notConfigured");
}
