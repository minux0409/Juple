using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Juple.Application.Translation;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Translation;

/// <summary>
/// Azure AI Translator, text API v3 (POST /translate?api-version=3.0), plain text. One call per target language, so one failing
/// language never hides the others. The key and region travel only in the request headers; neither they nor any translated text
/// are logged - only the status code and the classified failure.
/// </summary>
public sealed class AzureTextTranslator(HttpClient httpClient, AzureTranslatorOptions options, ILogger<AzureTextTranslator> logger) : ITextTranslator
{
    /// <summary>Well under the service's 50,000-character request limit; a longer text is refused instead of being cut.</summary>
    public const int MaxCharactersPerRequest = 25_000;

    public string ProviderName => TranslationOptions.ProviderAzure;

    public bool IsConfigured => true;

    public async Task<TranslationResult> TranslateAsync(TranslationRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Texts.Count == 0 || request.Texts.Sum(text => text.Length) > MaxCharactersPerRequest)
        {
            throw new TranslationUnavailableException("tooLong");
        }

        var query = $"translate?api-version=3.0&textType=plain&to={Uri.EscapeDataString(ToProvider(request.TargetLanguage))}";
        if (request.SourceLanguage is { } source)
        {
            query += $"&from={Uri.EscapeDataString(ToProvider(source))}";
        }

        using var message = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(options.Endpoint.TrimEnd('/') + "/"), query))
        {
            Content = JsonContent.Create(request.Texts.Select(text => new ProviderText(text)).ToArray()),
        };
        message.Headers.Add("Ocp-Apim-Subscription-Key", options.Key);
        message.Headers.Add("Ocp-Apim-Subscription-Region", options.Region);
        message.Headers.Add("X-ClientTraceId", Guid.NewGuid().ToString());

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(message, cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new TranslationUnavailableException("timeout");
        }
        catch (HttpRequestException)
        {
            throw new TranslationUnavailableException("unavailable");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                var code = response.StatusCode switch
                {
                    HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "providerRejected",
                    HttpStatusCode.TooManyRequests => "throttled",
                    HttpStatusCode.BadRequest or HttpStatusCode.RequestEntityTooLarge => "providerRejected",
                    _ => "unavailable",
                };
                logger.LogWarning("Azure AI Translator answered {StatusCode}; classified as {Code}.", (int)response.StatusCode, code);
                throw new TranslationUnavailableException(code);
            }

            ProviderResult[]? results;
            try
            {
                results = await response.Content.ReadFromJsonAsync<ProviderResult[]>(cancellationToken);
            }
            catch (System.Text.Json.JsonException)
            {
                throw new TranslationUnavailableException("invalidResponse");
            }

            if (results is null || results.Length != request.Texts.Count
                || results.Any(result => result.Translations is not { Length: > 0 } || result.Translations[0].Text is null))
            {
                throw new TranslationUnavailableException("invalidResponse");
            }

            var detected = results[0].DetectedLanguage?.Language;
            return new TranslationResult(
                results.Select(result => result.Translations![0].Text!).ToArray(),
                detected is null ? null : TranslationLanguages.FromLocale(detected) ?? detected);
        }
    }

    /// <summary>Juple's language codes are the provider's except Brazilian Portuguese, which the provider calls "pt".</summary>
    public static string ToProvider(string language) => language == "pt-BR" ? "pt" : language;

    private sealed record ProviderText([property: JsonPropertyName("Text")] string Text);

    private sealed class ProviderResult
    {
        [JsonPropertyName("detectedLanguage")] public ProviderDetected? DetectedLanguage { get; set; }

        [JsonPropertyName("translations")] public ProviderTranslation[]? Translations { get; set; }
    }

    private sealed class ProviderDetected
    {
        [JsonPropertyName("language")] public string? Language { get; set; }
    }

    private sealed class ProviderTranslation
    {
        [JsonPropertyName("text")] public string? Text { get; set; }
    }
}
