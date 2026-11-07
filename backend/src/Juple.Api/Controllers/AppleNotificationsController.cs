using Juple.Application.Billing;
using Juple.Application.Billing.Apple;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// App Store Server Notifications V2. NOT a Juple-login endpoint: Apple authenticates by SIGNING the payload (a JWS whose certificate chain
/// must lead to the pinned Apple root), which is verified before anything is read or stored. A notification is only a trigger: it is stored
/// durably and idempotently (the notification UUID is the event id), the worker is woken, and processing asks the App Store Server API for
/// the authoritative status - nothing here ever sets an entitlement from a notification type. Redeliveries answer 200 like the first
/// delivery; a payload that does not verify answers 400 and is never stored. There is deliberately no IP-based rate limit (it could throttle
/// Apple's own retries): the signature and the idempotency are the defence.
/// </summary>
[ApiController]
[Route("api/v1/billing/apple/notifications")]
[AllowAnonymous]
public sealed class AppleNotificationsController(BillingOptions options, IAppleBillingProcessor processor) : ControllerBase
{
    private const int MaxBodyBytes = 64 * 1024;

    [Juple.Api.Billing.AnonymousMutationReviewed("App Store Server Notifications V2, authenticated by Apple's JWS signature before anything is read or stored: store plumbing, not a person's content.")]
    [HttpPost]
    [RequestSizeLimit(MaxBodyBytes)]
    public async Task<IActionResult> ReceiveAsync([FromBody] NotificationEnvelope? envelope, CancellationToken cancellationToken)
    {
        if (!options.Apple.Enabled)
        {
            return NotFound();
        }

        if (envelope is null || string.IsNullOrWhiteSpace(envelope.SignedPayload))
        {
            return BadRequest();
        }

        try
        {
            await processor.IngestAsync(envelope.SignedPayload, cancellationToken);
            return Ok();
        }
        catch (Exception exception) when (exception is AppleSignatureException or AppleMalformedException)
        {
            return BadRequest();
        }
    }

    public sealed record NotificationEnvelope(string? SignedPayload);
}
