using Juple.Domain.Notices;
namespace Juple.Application.Notices;

/// <summary>
/// One language of a notice. Origin / SourceFingerprint are optional on write (an older Admin Web omits them = Manual); Korean is
/// always the Source. TranslatedAtUtc is set by the server.
/// </summary>
public sealed record NoticeText(string Language, string Title, string Body, string? Origin = null, string? SourceFingerprint = null, DateTimeOffset? TranslatedAtUtc = null);
public sealed record NoticeWrite(string Status, bool IsImportant, bool IsPinned, int Platforms,
    DateTimeOffset StartsAtUtc, DateTimeOffset? EndsAtUtc, string? OfficialUrl,
    IReadOnlyList<NoticeText> Translations, string? Version = null, bool ResetRead = false);
public sealed record NoticeItem(long Id, string Language, string Title, string Preview, DateTimeOffset PublishedAtUtc,
    bool IsImportant, bool IsPinned, bool IsRead, int ReadVersion);
public sealed record NoticeDetail(NoticeItem Notice, string Body, string? OfficialUrl);
public sealed record NoticePage(IReadOnlyList<NoticeItem> Items, string? NextCursor);
public sealed record AdminNotice(long Id, string Status, bool IsImportant, bool IsPinned, int Platforms,
    DateTimeOffset StartsAtUtc, DateTimeOffset? EndsAtUtc, string? OfficialUrl,
    IReadOnlyList<NoticeText> Translations, string Version, DateTimeOffset CreatedAtUtc, DateTimeOffset UpdatedAtUtc, int ReadVersion)
{
    /// <summary>The fingerprint of the CURRENT Korean title and body: a Machine translation with another fingerprint is out of date.</summary>
    public string? SourceFingerprint { get; init; }
}

/// <summary>One language's machine translation of the Korean draft (not saved - the admin reviews it and saves the notice).</summary>
public sealed record NoticeTranslationResult(string Language, string Status, string? Title, string? Body, string? ErrorCode);
public sealed record NoticeTranslationBatch(string Provider, string SourceFingerprint, DateTimeOffset TranslatedAtUtc, IReadOnlyList<NoticeTranslationResult> Results);
public sealed record NoticeTranslateRequest(string? Title, string? Body, IReadOnlyList<string>? Languages);
public sealed record AdminNoticeRow(long Id, string Title, string Status, bool IsImportant, bool IsPinned, DateTimeOffset StartsAtUtc, DateTimeOffset? EndsAtUtc, DateTimeOffset CreatedAtUtc)
{
    /// <summary>How many languages the notice has (Korean included) - 대상 언어 in the list.</summary>
    public int LanguageCount { get; init; }
}
public sealed record AdminNoticePage(IReadOnlyList<AdminNoticeRow> Items, string? NextCursor);
public sealed class NoticeNotFoundException : Exception;
public sealed class NoticeConflictException : Exception;
public sealed class InvalidNoticeException(string field, string message) : Exception(message) { public string Field { get; } = field; }

public interface INoticeStore
{
    Task<NoticePage> ListAsync(long userId, NoticePlatforms platform, string language, string? cursor, int limit, DateTimeOffset now, CancellationToken ct);
    Task<NoticeDetail?> GetAsync(long userId, long id, NoticePlatforms platform, string language, DateTimeOffset now, CancellationToken ct);
    Task<bool> HasUnreadAsync(long userId, NoticePlatforms platform, DateTimeOffset now, CancellationToken ct);
    Task MarkReadAsync(long userId, long id, NoticePlatforms platform, int readVersion, DateTimeOffset now, CancellationToken ct);
    Task<AdminNoticePage> AdminListAsync(string? search, NoticeStatus? status, long? cursor, int limit, CancellationToken ct);
    Task<AdminNotice?> AdminGetAsync(long id, CancellationToken ct);
    Task<AdminNotice> SaveAsync(long adminId, long? id, NoticeWrite write, DateTimeOffset now, CancellationToken ct);
    Task DeleteAsync(long adminId, long id, string version, DateTimeOffset now, CancellationToken ct);
}
public sealed class NoticeService(INoticeStore store, TimeProvider time)
{
    public static readonly string[] Languages = ["ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "fr", "de", "it", "pt-BR", "vi", "th", "id", "ru", "tr", "ar", "hi"];
    public static string Language(string? value) => Languages.FirstOrDefault(x => string.Equals(x, value, StringComparison.OrdinalIgnoreCase)) ?? "ko";
    public static NoticePlatforms Platform(string value) => value.ToLowerInvariant() switch {
        "web" => NoticePlatforms.Web, "android" => NoticePlatforms.Android, "ios" => NoticePlatforms.Ios,
        _ => throw new InvalidNoticeException("platform", "Use web, android or ios.") };
    public static int Limit(int? value) => Math.Clamp(value ?? 20, 1, 100);
    public static NoticeStatus? Status(string? value) => value is null ? null : Enum.TryParse<NoticeStatus>(value, true, out var status) && Enum.IsDefined(status)
        ? status : throw new InvalidNoticeException("status", "Use Draft or Published.");
    public Task<NoticePage> ListAsync(long user, string platform, string? lang, string? cursor, int? limit, CancellationToken ct) =>
        store.ListAsync(user, Platform(platform), Language(lang), cursor, Limit(limit), time.GetUtcNow(), ct);
    public async Task<NoticeDetail> GetAsync(long user, long id, string platform, string? lang, CancellationToken ct) =>
        await store.GetAsync(user, id, Platform(platform), Language(lang), time.GetUtcNow(), ct) ?? throw new NoticeNotFoundException();
    public Task<bool> HasUnreadAsync(long user, string platform, CancellationToken ct) => store.HasUnreadAsync(user, Platform(platform), time.GetUtcNow(), ct);
    public Task MarkReadAsync(long user, long id, string platform, int version, CancellationToken ct) =>
        store.MarkReadAsync(user, id, Platform(platform), version, time.GetUtcNow(), ct);
    public Task<AdminNoticePage> AdminListAsync(string? search, string? status, long? cursor, int? limit, CancellationToken ct) =>
        store.AdminListAsync(search?.Trim()[..Math.Min(search.Trim().Length, 200)], Status(status), cursor, Limit(limit), ct);
    public async Task<AdminNotice> AdminGetAsync(long id, CancellationToken ct) => await store.AdminGetAsync(id, ct) ?? throw new NoticeNotFoundException();
    public Task<AdminNotice> SaveAsync(long admin, long? id, NoticeWrite write, CancellationToken ct) {
        Validate(write);
        if (id is not null && string.IsNullOrEmpty(write.Version)) throw new InvalidNoticeException("version", "Version is required.");
        return store.SaveAsync(admin, id, write, time.GetUtcNow(), ct);
    }
    public Task DeleteAsync(long admin, long id, string version, CancellationToken ct) => store.DeleteAsync(admin, id, version, time.GetUtcNow(), ct);
    public static void Validate(NoticeWrite write) {
        _ = Status(write.Status ?? "");
        if (write.Platforms < 1 || (write.Platforms & ~7) != 0) throw new InvalidNoticeException("platforms", "Select at least one supported platform.");
        if (write.StartsAtUtc == default || write.EndsAtUtc <= write.StartsAtUtc) throw new InvalidNoticeException("endsAtUtc", "End must follow start.");
        if (write.OfficialUrl is not null && (!Uri.TryCreate(write.OfficialUrl, UriKind.Absolute, out var url) || url.Scheme != "https" || !string.IsNullOrEmpty(url.UserInfo) || write.OfficialUrl.Length > 2048))
            throw new InvalidNoticeException("officialUrl", "Use an absolute HTTPS link without credentials.");
        if (write.Translations is null || write.Translations.Count is < 1 or > 17 || !write.Translations.Any(t => t.Language == "ko"))
            throw new InvalidNoticeException("translations", "Korean title and body are required.");
        if (write.Translations.Select(t => t.Language).Distinct().Count() != write.Translations.Count) throw new InvalidNoticeException("translations", "Duplicate language.");
        foreach (var text in write.Translations) {
            if (!Languages.Contains(text.Language) || string.IsNullOrWhiteSpace(text.Title) || text.Title.Length > 200 || string.IsNullOrWhiteSpace(text.Body) || text.Body.Length > 20000)
                throw new InvalidNoticeException("translations", "Use supported languages, title <=200 and body <=20000 characters.");
            var knownOrigin = text.Origin is null or NoticeTranslation.OriginSource or NoticeTranslation.OriginMachine or NoticeTranslation.OriginManual;
            var sourceIsKorean = text.Language == "ko" ? text.Origin is null or NoticeTranslation.OriginSource : text.Origin != NoticeTranslation.OriginSource;
            var fingerprintOk = text.SourceFingerprint is null ? text.Origin != NoticeTranslation.OriginMachine : IsFingerprint(text.SourceFingerprint);
            if (!knownOrigin || !sourceIsKorean || !fingerprintOk)
                throw new InvalidNoticeException("translations", "Korean is the source; other languages are Machine (with the source fingerprint) or Manual.");
        }
    }

    /// <summary>The identity of a Korean original: SHA-256 (lower-case hex) of its trimmed title, a line feed and its trimmed body.</summary>
    public static string SourceFingerprint(string title, string body) =>
        Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"{title.Trim()}\n{body.Trim()}"))).ToLowerInvariant();

    private static bool IsFingerprint(string? value) => value is { Length: 64 } && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
}

/// <summary>
/// 공지사항 자동 번역: the Korean draft into the chosen languages, one provider call per language (four at a time), nothing saved.
/// A failed language says so and keeps no text; no language is ever reported as translated without the provider's answer.
/// </summary>
public sealed class NoticeTranslationService(Juple.Application.Translation.ITextTranslator translator, TimeProvider time)
{
    private static readonly SemaphoreSlim BatchSlots = new(1);

    public string ProviderName => translator.ProviderName;

    public bool IsConfigured => translator.IsConfigured;

    public async Task<NoticeTranslationBatch> TranslateAsync(NoticeTranslateRequest request, CancellationToken ct)
    {
        var title = request.Title?.Trim() ?? "";
        var body = request.Body?.Trim() ?? "";
        if (title.Length is < 1 or > 200 || body.Length is < 1 or > 20000)
            throw new InvalidNoticeException("translations", "Korean title (1-200) and body (1-20000) are required.");
        var targets = (request.Languages is { Count: > 0 } chosen ? chosen : NoticeService.Languages.Where(x => x != "ko").ToArray()).ToArray();
        if (targets.Distinct(StringComparer.Ordinal).Count() != targets.Length || targets.Any(x => x == "ko" || !NoticeService.Languages.Contains(x)))
            throw new InvalidNoticeException("languages", "Choose distinct supported languages other than Korean.");
        if (!translator.IsConfigured) throw new Juple.Application.Translation.TranslationUnavailableException("notConfigured");
        if (!await BatchSlots.WaitAsync(TimeSpan.FromSeconds(1), ct)) throw new Juple.Application.Translation.TranslationUnavailableException("busy");
        try
        {
            using var lanes = new SemaphoreSlim(4);
            var results = await Task.WhenAll(targets.Select(async language =>
            {
                await lanes.WaitAsync(ct);
                try
                {
                    var translated = await translator.TranslateAsync(new([title, body], "ko", language), ct);
                    var (translatedTitle, translatedBody) = (translated.Texts[0].Trim(), translated.Texts[1].Trim());
                    return translatedTitle.Length is < 1 or > 200 || translatedBody.Length is < 1 or > 20000
                        ? new NoticeTranslationResult(language, "failed", null, null, "resultOutOfBounds")
                        : new NoticeTranslationResult(language, "translated", translatedTitle, translatedBody, null);
                }
                catch (Juple.Application.Translation.TranslationUnavailableException e)
                {
                    return new NoticeTranslationResult(language, "failed", null, null, e.Code);
                }
                finally { lanes.Release(); }
            }));
            return new NoticeTranslationBatch(translator.ProviderName, NoticeService.SourceFingerprint(title, body), time.GetUtcNow(), results);
        }
        finally { BatchSlots.Release(); }
    }
}
