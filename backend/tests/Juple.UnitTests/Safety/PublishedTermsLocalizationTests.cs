using System.Text.Json;
using System.Text.Json.Nodes;
using Juple.Application.Safety;

namespace Juple.UnitTests.Safety;

public sealed class PublishedTermsLocalizationTests
{
    [Fact]
    public void All17LanguagesFallbackWithoutCreatingTranslatedConsent()
    {
        foreach (var version in new[] { "2026-10-14", "2026-11-27" })
        foreach (var language in new[] { "ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "fr", "de", "it", "pt-BR", "vi", "th", "id", "ru", "tr", "ar", "hi" })
        {
            var doc = JsonSerializer.SerializeToElement(PublishedTerms.GetDocument(version, language));
            Assert.Equal("ko", doc.GetProperty("language").GetString());
            Assert.Equal(language == "ko", doc.GetProperty("canAccept").GetBoolean());
            Assert.Equal(language == "ko", PublishedTerms.Matches(version, doc.GetProperty("contentHash").GetString(), language));
        }
    }

    [Fact]
    public void TranslationRequiresIndependentReviewSourceVersionAndExactBody()
    {
        using var stream = typeof(PublishedTerms).Assembly.GetManifestResourceStream("Juple.Application.Safety.PublishedTerms.json")!;
        var source = JsonNode.Parse(stream)!;
        var translation = source.DeepClone();
        translation["language"] = "en";
        translation["sourceContentHash"] = source["contentHash"]!.GetValue<string>();
        translation["approval"] = new JsonObject { ["status"] = "approved", ["legalReview"] = "test-only", ["languageReview"] = "test-only" };
        source["approvedTranslations"] = new JsonArray(translation);
        JsonElement Resolve() => PublishedTerms.SelectSource(JsonSerializer.SerializeToElement(source), "en");
        Assert.Equal("en", Resolve().GetProperty("language").GetString());
        translation["approval"]!["status"] = "draft";
        Assert.Equal("ko", Resolve().GetProperty("language").GetString());
        translation["approval"]!["status"] = "approved";
        translation["sourceContentHash"] = "wrong";
        Assert.Equal("ko", Resolve().GetProperty("language").GetString());
        translation["sourceContentHash"] = source["contentHash"]!.GetValue<string>();
        translation["contentHash"] = new string('0', 64);
        Assert.Throws<InvalidOperationException>(() => Resolve());
    }
}
