using Juple.Application.Items.InstagramMetadataCandidate;

namespace Juple.Application.UrlMetadata.PreviewInstagramMetadataCandidate;

/// <summary>
/// Pre-save counterpart of ApplyInstagramMetadataCandidateService for NewLinkReview: the same raw
/// device candidate, run through the same IInstagramMetadataCandidateNormalizer (identity, title and
/// image rules - never a second copy), but against the URL being reviewed instead of a saved Item,
/// and with nothing persisted. The client only displays the result; the saved Item still gets its
/// metadata through the Item-scoped candidate endpoint after Save.
/// </summary>
public sealed class PreviewInstagramMetadataCandidateService(IInstagramMetadataCandidateNormalizer normalizer)
    : IPreviewInstagramMetadataCandidateService
{
    public NormalizedInstagramMetadata Preview(PreviewInstagramMetadataCandidateCommand command)
    {
        var sourceUrl = command.SourceUrl?.Trim();
        if (string.IsNullOrEmpty(sourceUrl) || sourceUrl.Length > ApplyInstagramMetadataCandidateService.MaxUrlLength)
        {
            throw new InvalidUrlMetadataRequestException("sourceUrl", "A source URL is required.");
        }

        var candidate = command.Candidate;
        ValidateLength("ogTitle", candidate.OgTitle, ApplyInstagramMetadataCandidateService.MaxTitleLength);
        ValidateLength("ogDescription", candidate.OgDescription, ApplyInstagramMetadataCandidateService.MaxDescriptionLength);
        ValidateLength("ogImage", candidate.OgImage, ApplyInstagramMetadataCandidateService.MaxUrlLength);
        ValidateLength("ogUrl", candidate.OgUrl, ApplyInstagramMetadataCandidateService.MaxUrlLength);

        return normalizer.Normalize(sourceUrl, candidate)
            ?? throw new InvalidUrlMetadataRequestException(
                "candidate", "The metadata candidate does not belong to this Instagram URL.");
    }

    private static void ValidateLength(string field, string? value, int maxLength)
    {
        if (value is not null && value.Length > maxLength)
        {
            throw new InvalidUrlMetadataRequestException(field, $"{field} is too long.");
        }
    }
}
