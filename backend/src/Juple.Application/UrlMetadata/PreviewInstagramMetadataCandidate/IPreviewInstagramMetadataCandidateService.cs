using Juple.Application.Items.InstagramMetadataCandidate;

namespace Juple.Application.UrlMetadata.PreviewInstagramMetadataCandidate;

public interface IPreviewInstagramMetadataCandidateService
{
    NormalizedInstagramMetadata Preview(PreviewInstagramMetadataCandidateCommand command);
}
