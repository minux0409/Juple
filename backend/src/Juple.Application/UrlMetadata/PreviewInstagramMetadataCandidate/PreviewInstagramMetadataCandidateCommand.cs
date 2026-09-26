using Juple.Application.Items.InstagramMetadataCandidate;

namespace Juple.Application.UrlMetadata.PreviewInstagramMetadataCandidate;

/// <summary>The URL being reviewed (no Item exists yet) plus the device's raw OpenGraph candidate for it.</summary>
public sealed record PreviewInstagramMetadataCandidateCommand(string? SourceUrl, InstagramMetadataCandidateCommand Candidate);
