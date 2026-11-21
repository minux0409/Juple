using Juple.Application.Identity;
using Juple.Domain.Billing;

namespace Juple.Application.Users.BootstrapCurrentUser;

public sealed record CurrentUserBootstrapData(
    ExternalIdentityPrincipal ExternalIdentity,
    string PreferredLocale,
    string TimeZoneId,
    string? DefaultCurrencyCode,
    DateTimeOffset CreatedAtUtc,
    byte[]? TrialEmailHash = null,
    byte[]? TrialIdentityHash = null,
    TrialWindow? OfficialTrialWindow = null);
