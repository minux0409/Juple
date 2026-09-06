namespace Juple.Api.Configuration;

/// <summary>
/// Bound from the "PublicWeb" configuration section. BaseUrl is the canonical origin of the Public
/// Web Viewer (e.g. http://localhost:3000 locally) - the API composes the full share URL from
/// this plus a PublicId (see CollectionsController.BuildShareUrl) so the Mobile client never
/// assembles or hardcodes it. No real production domain is configured here yet - see
/// appsettings.Development.json for the local-only default; Production's value is TBD and must be
/// supplied via environment configuration when that domain exists, never hardcoded in source.
/// </summary>
public sealed class PublicWebOptions
{
    public string BaseUrl { get; set; } = string.Empty;
}
