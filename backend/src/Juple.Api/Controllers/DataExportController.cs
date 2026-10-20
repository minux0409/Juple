using System.Globalization;
using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Application.Collections.Locking;
using Juple.Application.DataExport;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using Juple.Api.Configuration;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// The signed-in person's own data export (RET-03). Reading what an export contains and asking for its download links never changes
/// content, so it stays open in every subscription state (read-only included) and before the current Terms are accepted - taking your
/// data with you must never depend on agreeing to new terms. The person always comes from the token, never from the request.
/// 404 <c>dataExportDisabled</c> while DataExport:Enabled is false.
/// </summary>
[ApiController]
[Route("api/v1/users/me/data-export")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
[Juple.Api.Safety.AllowWithoutTermsAcceptance]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
[EnableRateLimiting(RateLimitPolicies.DataExport)]
public sealed class DataExportController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IDataExportService exportService) : ControllerBase
{
    public const string DownloadPathPrefix = "/api/v1/data-export/downloads#";

    [HttpGet]
    public async Task<IActionResult> GetSummaryAsync(CancellationToken cancellationToken)
    {
        try
        {
            var userId = (await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), cancellationToken)).UserId;
            return Ok(DataExportSummaryResponse.From(await exportService.GetSummaryAsync(userId, cancellationToken)));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Juple user bootstrap is required.");
        }
        catch (DataExportDisabledException)
        {
            return Disabled();
        }
        catch (DataExportLimitExceededException)
        {
            return LimitExceeded();
        }
    }

    /// <summary>
    /// Creates the download links of one export - the data file and every photo file - after a recent sign-in (403
    /// <c>recentAuthenticationRequired</c> otherwise, like resetting the Collection lock password: the export contains every memo and
    /// locked Collection). Each link permits one download authorization within at most 15 minutes. 429 <c>dataExportRateLimited</c> after too many
    /// requests in 24 hours.
    /// </summary>
    [HttpPost("links")]
    public async Task<IActionResult> CreateLinksAsync(CancellationToken cancellationToken)
    {
        try
        {
            var userId = (await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), cancellationToken)).UserId;
            var created = await exportService.CreateLinksAsync(userId, AuthenticationTimeClaim.Read(User), cancellationToken);
            return Ok(DataExportLinksResponse.From(created));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Juple user bootstrap is required.");
        }
        catch (DataExportDisabledException)
        {
            return Disabled();
        }
        catch (RecentAuthenticationRequiredException)
        {
            return CollectionProblems.RecentAuthenticationRequired();
        }
        catch (DataExportRateLimitedException)
        {
            return CollectionProblems.Create(StatusCodes.Status429TooManyRequests, "Too many data exports were requested today.", "dataExportRateLimited");
        }
        catch (DataExportLimitExceededException)
        {
            return LimitExceeded();
        }
    }

    private static ObjectResult Disabled() =>
        CollectionProblems.Create(StatusCodes.Status404NotFound, "Data export is not available.", "dataExportDisabled");

    private static ObjectResult LimitExceeded() =>
        CollectionProblems.Create(StatusCodes.Status413PayloadTooLarge, "This export exceeds the processing limits.", "dataExportLimitExceeded");

    public sealed record DataExportPhotoFileResponse(int Number, int Photos, long Bytes);

    public sealed record DataExportSummaryResponse(
        int Links,
        int LinksInTrash,
        int OwnedCollections,
        int SharedCollectionsJoined,
        int Comments,
        int Purchases,
        int RepeatPurchases,
        int Photos,
        long PhotoBytes,
        IReadOnlyList<DataExportPhotoFileResponse> PhotoFiles)
    {
        public static DataExportSummaryResponse From(DataExportSummary summary) => new(
            summary.Counts.Links,
            summary.Counts.LinksInTrash,
            summary.Counts.OwnedCollections,
            summary.Counts.SharedMemberships,
            summary.Counts.Comments,
            summary.Counts.Purchases,
            summary.Counts.RepeatPurchases,
            summary.Counts.Photos,
            summary.Counts.PhotoBytes,
            [.. summary.ImageParts.Select(part => new DataExportPhotoFileResponse(part.Number, part.ImageCount, part.ByteCount))]);
    }

    /// <param name="Kind">"data" or "photos".</param>
    /// <param name="DownloadPath">API-relative; the app opens API base + this path in the browser / system downloader.</param>
    public sealed record DataExportFileLinkResponse(string Kind, int? Number, string FileName, string DownloadPath, int? Photos, long? Bytes);

    public sealed record DataExportLinksResponse(DateTimeOffset ExpiresAtUtc, IReadOnlyList<DataExportFileLinkResponse> Files)
    {
        public static DataExportLinksResponse From(IReadOnlyList<DataExportLinkCreated> created) => new(
            created.Min(link => link.ExpiresAtUtc),
            [.. created.Select(link => new DataExportFileLinkResponse(
                link.Part == DataExportPart.Images ? "photos" : "data",
                link.PhotoFileNumber,
                link.FileName,
                DownloadPathPrefix + link.Token,
                link.PhotoCount,
                link.ByteCount))]);
    }
}

/// <summary>
/// The download itself. Anonymous because the system browser cannot send the app's bearer token; a 256-bit capability is handed off
/// in the URL fragment and submitted in the POST body (stored only as a hash, valid for at most 15 minutes and one claim, bound to the account and the
/// file it was created for). An unknown, expired or used-up token is a plain 404 - nothing tells it apart. The ZIP is streamed.
/// </summary>
[ApiController]
[Route("api/v1/data-export/downloads")]
[AllowAnonymous]
[EnableRateLimiting(RateLimitPolicies.DataExportDownload)]
public sealed class DataExportDownloadController(IDataExportService exportService, ILogger<DataExportDownloadController> logger) : ControllerBase
{
    // Fragments never reach HTTP access logs or Referer. Remove the fragment from browser history before posting the capability.
    // This page loads no assets, analytics, cookies or third-party code. Request-body logging must stay disabled for this route.
    public const string DownloadScript = "const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);if(/^[A-Za-z0-9_-]{43}$/.test(token)){const form=document.createElement('form');form.method='POST';form.action=location.pathname;const input=document.createElement('input');input.type='hidden';input.name='token';input.value=token;form.append(input);document.body.append(form);form.submit();form.remove();}";

    [HttpGet]
    public IActionResult DownloadPage()
    {
        SetPrivateHeaders();
        var hash = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(DownloadScript)));
        Response.Headers["Content-Security-Policy"] = $"default-src 'none'; script-src 'sha256-{hash}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
        return Content("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>Juple download</title></head><body><p>Juple download</p><script>" + DownloadScript + "</script></body></html>", "text/html", Encoding.UTF8);
    }

    [HttpPost]
    [Juple.Api.Billing.AnonymousMutationReviewed("Read-only export delivery; a short-lived hashed capability authorizes one person's file and atomically consumes a bounded use.")]
    [RequestSizeLimit(1024)]
    [RequestFormLimits(ValueLengthLimit = 64, ValueCountLimit = 1)]
    public async Task<IActionResult> DownloadAsync([FromForm] string token, CancellationToken cancellationToken)
    {
        SetPrivateHeaders();
        var download = await exportService.OpenDownloadAsync(token, cancellationToken);
        if (download is null)
        {
            return NotFound();
        }

        Response.StatusCode = StatusCodes.Status200OK;
        Response.ContentType = "application/zip";
        Response.Headers[HeaderNames.ContentDisposition] = new ContentDispositionHeaderValue("attachment") { FileName = download.FileName }.ToString();
        HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();

        try
        {
            await exportService.WriteAsync(download, Response.Body, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The download was cancelled by the person (or the connection dropped): nothing to report.
        }
        catch (Exception)
        {
            // The headers are already sent: the client sees a truncated file. Only the part kind is logged - never the token or content.
            // Storage/SQL exceptions may contain private paths or query parameters. Log only the bounded part name.
            logger.LogError("Data export download failed while writing the {Part} file.", download.Part.ToString().ToLower(CultureInfo.InvariantCulture));
            HttpContext.Abort();
        }

        return new EmptyResult();
    }

    private void SetPrivateHeaders()
    {
        Response.Headers[HeaderNames.CacheControl] = "no-store";
        Response.Headers[HeaderNames.XContentTypeOptions] = "nosniff";
        Response.Headers["Referrer-Policy"] = "no-referrer";
    }
}
