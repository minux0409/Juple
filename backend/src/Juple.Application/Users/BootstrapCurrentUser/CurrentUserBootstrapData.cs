using Juple.Application.Identity;

namespace Juple.Application.Users.BootstrapCurrentUser;

public sealed record CurrentUserBootstrapData(
    ExternalIdentityPrincipal ExternalIdentity,
    string PreferredLocale,
    string TimeZoneId,
    string? DefaultCurrencyCode,
    DateTimeOffset CreatedAtUtc);