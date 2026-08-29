namespace Juple.Application.Users.BootstrapCurrentUser;

public sealed record BootstrapCurrentUserCommand(string? PreferredLocale, string? TimeZoneId);