namespace Juple.Application.Items.InstagramMetadataCandidate;

public interface IApplyInstagramMetadataCandidateService
{
    Task<InstagramMetadataCandidateResult> ApplyAsync(
        long userId,
        long itemId,
        InstagramMetadataCandidateCommand candidate,
        CancellationToken cancellationToken = default);
}
