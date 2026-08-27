namespace Juple.Domain.Users;

public sealed class User
{
    private User()
    {
    }

    public User(
        string preferredLocale,
        string timeZoneId,
        string? defaultCurrencyCode,
        DateTimeOffset createdAtUtc,
        DateTimeOffset updatedAtUtc)
    {
        PreferredLocale = preferredLocale;
        TimeZoneId = timeZoneId;
        DefaultCurrencyCode = defaultCurrencyCode;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = updatedAtUtc;
    }

    public long Id { get; private set; }

    public string PreferredLocale { get; private set; } = null!;

    public string TimeZoneId { get; private set; } = null!;

    public string? DefaultCurrencyCode { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];
}
