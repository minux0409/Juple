using System.Text.Json;
using System.Text.Json.Nodes;
using Juple.Application.Safety;

namespace Juple.UnitTests.Safety;

/// <summary>
/// A new terms version must not make an earlier published text disappear: the version it replaces is archived - readable, never agreed to.
/// The historical 2026-10-14 consent original and the 2026-10-25 public terms both stay intact.
/// </summary>
public sealed class PublishedTermsArchiveTests
{
    private static JsonNode Resource(string name)
    {
        using var stream = typeof(PublishedTerms).Assembly.GetManifestResourceStream($"Juple.Application.Safety.{name}")!;
        return JsonNode.Parse(stream)!;
    }

    // An earlier revision with the same body: the hash covers the body only, so only the version / revision change.
    private static JsonNode Revision(JsonNode source, string version)
    {
        var copy = source.DeepClone();
        copy["version"] = version;
        copy["document"]!["updated"] = version;
        return copy;
    }

    [Fact]
    public void BothExistingDocumentsStayPublishedAndTheArchiveStartsEmpty()
    {
        Assert.Equal("2026-10-25", PublishedTerms.Version);
        Assert.Equal("91017e970bc9e0922161d6bed0b29261c92858a4c01582b46af714d871f3b72b", PublishedTerms.ContentHash);
        Assert.Equal("4559616eb6d94d7b9158e1e74f96cb33793394cc3d8b5889468a53c468b824c2", Resource("LegacyPublishedTerms.json")["contentHash"]!.GetValue<string>());
        Assert.Empty(Resource("ArchivedPublishedTerms.json").AsArray());
        Assert.NotNull(PublishedTerms.GetDocument("2026-10-14", "ko"));
        Assert.NotNull(PublishedTerms.GetDocument("2026-10-25", "ko"));
    }

    [Fact]
    public void AnArchivedVersionIsReadableButCanNeverBeAccepted()
    {
        var archivedNode = Revision(Resource("PublishedTerms.json"), "2026-09-01");
        var archived = PublishedTerms.ValidateArchive(JsonSerializer.SerializeToElement(new JsonArray(archivedNode)));

        var document = JsonSerializer.SerializeToElement(PublishedTerms.GetDocument("2026-09-01", "ko", archived));
        Assert.Equal("2026-09-01", document.GetProperty("version").GetString());
        Assert.False(document.GetProperty("canAccept").GetBoolean());
        Assert.False(PublishedTerms.Matches("2026-09-01", archivedNode["contentHash"]!.GetValue<string>(), "ko"));
        Assert.False(PublishedTerms.AllowsLegacyRequest("2026-09-01"));

        // The documents in force are unaffected by the archive.
        Assert.True(PublishedTerms.Matches("2026-10-25", PublishedTerms.ContentHash, "ko"));
        Assert.Null(PublishedTerms.GetDocument("2026-09-02", "ko", archived));
    }

    [Fact]
    public void TheArchiveRefusesATamperedBodyOrAVersionPublishedTwice()
    {
        var current = Resource("PublishedTerms.json");
        var legacy = Resource("LegacyPublishedTerms.json");
        var inForce = new[] { JsonSerializer.SerializeToElement(current), JsonSerializer.SerializeToElement(legacy) };

        var tampered = Revision(current, "2026-09-01");
        tampered["document"]!["intro"] = "changed";
        Assert.Throws<InvalidOperationException>(() => PublishedTerms.ValidateArchive(JsonSerializer.SerializeToElement(new JsonArray(tampered)), inForce));

        var mismatchedRevision = Revision(current, "2026-09-01");
        mismatchedRevision["document"]!["updated"] = "2026-09-02";
        Assert.Throws<InvalidOperationException>(() => PublishedTerms.ValidateArchive(JsonSerializer.SerializeToElement(new JsonArray(mismatchedRevision)), inForce));

        Assert.Throws<InvalidOperationException>(() => PublishedTerms.ValidateArchive(JsonSerializer.SerializeToElement(new JsonArray(current.DeepClone())), inForce));
        Assert.Throws<InvalidOperationException>(() => PublishedTerms.ValidateArchive(JsonSerializer.SerializeToElement(new JsonArray(Revision(current, "2026-09-01"), Revision(current, "2026-09-01"))), inForce));
    }
}
