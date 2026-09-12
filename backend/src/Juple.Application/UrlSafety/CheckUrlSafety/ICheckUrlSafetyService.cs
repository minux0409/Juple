namespace Juple.Application.UrlSafety.CheckUrlSafety;

public interface ICheckUrlSafetyService
{
    Task<UrlSafetyResult> CheckAsync(CheckUrlSafetyCommand command, CancellationToken cancellationToken = default);
}
