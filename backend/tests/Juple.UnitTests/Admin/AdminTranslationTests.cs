using System.Net;
using System.Text;
using Juple.Application.Admin;
using Juple.Application.Notices;
using Juple.Application.Translation;
using Juple.Infrastructure.Translation;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.UnitTests.Admin;

/// <summary>The translation seam: languages, configuration, the Azure adapter's wire format and failure classification.</summary>
public sealed class TranslationFoundationTests
{
    [Theory]
    [InlineData("ko-KR", "ko")]
    [InlineData("en_US", "en")]
    [InlineData("pt-PT", "pt-BR")]
    [InlineData("zh-Hant-TW", "zh-Hant")]
    [InlineData("zh-TW", "zh-Hant")]
    [InlineData("zh-CN", "zh-Hans")]
    [InlineData("zh-Hans", "zh-Hans")]
    [InlineData("ja", "ja")]
    [InlineData("xx-YY", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void ADeviceLocale_MapsToOneOfJuplesLanguages(string? locale, string? expected)
    {
        Assert.Equal(expected, TranslationLanguages.FromLocale(locale));
    }

    [Fact]
    public void TheSupportedLanguages_AreExactlyTheNoticeLanguages()
    {
        Assert.Equal(NoticeService.Languages, TranslationLanguages.Supported);
        Assert.Equal(17, TranslationLanguages.Supported.Count);
    }

    [Fact]
    public void TheDefaultConfiguration_HasNoProvider_AndIsValid()
    {
        var options = new TranslationOptions();
        Assert.Null(options.Validate());
        Assert.False(options.IsAzure);
    }

    [Theory]
    [InlineData("Papago", null, null, false)]
    [InlineData("AzureAITranslator", null, "koreacentral", false)]
    [InlineData("AzureAITranslator", "key", null, false)]
    [InlineData("None", null, null, true)]
    public void AContradictoryConfiguration_IsRefused(string provider, string? key, string? region, bool allowInquiries)
    {
        var options = new TranslationOptions { Provider = provider, AllowInquiryTranslation = allowInquiries, AzureTranslator = { Key = key, Region = region } };
        Assert.NotNull(options.Validate());
    }

    [Fact]
    public async Task TheDisabledTranslator_RefusesEveryRequest_AsNotConfigured()
    {
        var error = await Assert.ThrowsAsync<TranslationUnavailableException>(() => new DisabledTextTranslator().TranslateAsync(new(["x"], "ko", "en")));
        Assert.Equal("notConfigured", error.Code);
    }

    [Fact]
    public async Task TheAzureAdapter_SendsThePlainTextApiRequest_AndReadsTheTranslations()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, """[{"detectedLanguage":{"language":"pt","score":1.0},"translations":[{"text":"Olá","to":"pt"}]},{"translations":[{"text":"Corpo","to":"pt"}]}]""");
        var translator = Adapter(handler);

        var result = await translator.TranslateAsync(new(["안녕", "본문"], "ko", "pt-BR"));

        Assert.Equal(["Olá", "Corpo"], result.Texts);
        Assert.Equal("pt-BR", result.DetectedLanguage);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://translator.example/translate?api-version=3.0&textType=plain&to=pt&from=ko", request.Uri);
        Assert.Equal("secret-key", request.Headers["Ocp-Apim-Subscription-Key"]);
        Assert.Equal("koreacentral", request.Headers["Ocp-Apim-Subscription-Region"]);
        var sent = System.Text.Json.JsonDocument.Parse(request.Body).RootElement.EnumerateArray().Select(item => item.GetProperty("Text").GetString() ?? string.Empty).ToArray();
        Assert.Equal(["안녕", "본문"], sent);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "providerRejected")]
    [InlineData(HttpStatusCode.Forbidden, "providerRejected")]
    [InlineData(HttpStatusCode.TooManyRequests, "throttled")]
    [InlineData(HttpStatusCode.ServiceUnavailable, "unavailable")]
    public async Task AProviderFailure_IsClassified_AndNeverCarriesTheKey(HttpStatusCode status, string code)
    {
        var error = await Assert.ThrowsAsync<TranslationUnavailableException>(() => Adapter(new FakeHandler(status, "{}")).TranslateAsync(new(["x"], "ko", "en")));

        Assert.Equal(code, error.Code);
        Assert.DoesNotContain("secret-key", error.Message);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""[{"translations":[]}]""")]
    public async Task AMalformedAnswer_IsInvalidResponse_NotATranslation(string body)
    {
        var error = await Assert.ThrowsAsync<TranslationUnavailableException>(() => Adapter(new FakeHandler(HttpStatusCode.OK, body)).TranslateAsync(new(["x"], "ko", "en")));
        Assert.Equal("invalidResponse", error.Code);
    }

    [Fact]
    public async Task AnOversizedText_IsRefused_BeforeAnythingIsSent()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, "[]");
        var error = await Assert.ThrowsAsync<TranslationUnavailableException>(() =>
            Adapter(handler).TranslateAsync(new([new string('가', AzureTextTranslator.MaxCharactersPerRequest + 1)], "ko", "en")));

        Assert.Equal("tooLong", error.Code);
        Assert.Empty(handler.Requests);
    }

    private static AzureTextTranslator Adapter(FakeHandler handler) =>
        new(new HttpClient(handler), new AzureTranslatorOptions { Endpoint = "https://translator.example", Key = "secret-key", Region = "koreacentral" }, NullLogger<AzureTextTranslator>.Instance);

    internal sealed class FakeHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public List<(string Uri, Dictionary<string, string> Headers, string Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add((request.RequestUri!.ToString(), request.Headers.ToDictionary(h => h.Key, h => string.Join(",", h.Value)),
                request.Content is null ? "" : await request.Content.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }
}

/// <summary>공지사항 자동 번역: nothing saved, per-language outcome, and the rules that protect hand-edited translations.</summary>
public sealed class NoticeTranslationServiceTests
{
    [Fact]
    public async Task WithoutAProvider_NothingIsTranslated()
    {
        var service = new NoticeTranslationService(new DisabledTextTranslator(), TimeProvider.System);

        var error = await Assert.ThrowsAsync<TranslationUnavailableException>(() => service.TranslateAsync(new("제목", "본문", null), CancellationToken.None));
        Assert.Equal("notConfigured", error.Code);
    }

    [Fact]
    public async Task EveryOtherLanguage_IsTranslatedByDefault_AndOneFailureDoesNotHideTheOthers()
    {
        var translator = new ScriptedTranslator(language => language == "ja" ? throw new TranslationUnavailableException("throttled") : [$"T-{language}", $"B-{language}"]);
        var batch = await new NoticeTranslationService(translator, TimeProvider.System).TranslateAsync(new(" 제목 ", " 본문 ", null), CancellationToken.None);

        Assert.Equal(16, batch.Results.Count);
        Assert.DoesNotContain(batch.Results, result => result.Language == "ko");
        var japanese = Assert.Single(batch.Results, result => result.Language == "ja");
        Assert.Equal(("failed", "throttled", (string?)null), (japanese.Status, japanese.ErrorCode, japanese.Title));
        var english = Assert.Single(batch.Results, result => result.Language == "en");
        Assert.Equal(("translated", "T-en", "B-en"), (english.Status, english.Title, english.Body));
        Assert.Equal(NoticeService.SourceFingerprint("제목", "본문"), batch.SourceFingerprint);
        Assert.All(translator.Requests, request => Assert.Equal(("ko", "제목", "본문"), (request.SourceLanguage, request.Texts[0], request.Texts[1])));
    }

    [Fact]
    public async Task ATranslationThatDoesNotFitTheNotice_IsReportedAsFailed()
    {
        var translator = new ScriptedTranslator(_ => [new string('x', 201), "body"]);
        var batch = await new NoticeTranslationService(translator, TimeProvider.System).TranslateAsync(new("제목", "본문", ["en"]), CancellationToken.None);

        Assert.Equal(("failed", "resultOutOfBounds"), (batch.Results[0].Status, batch.Results[0].ErrorCode));
    }

    [Theory]
    [InlineData("", "본문", null)]
    [InlineData("제목", "", null)]
    [InlineData("제목", "본문", "ko")]
    [InlineData("제목", "본문", "xx")]
    public async Task AnInvalidRequest_IsRefused_BeforeTheProvider(string title, string body, string? language)
    {
        var translator = new ScriptedTranslator(_ => ["a", "b"]);
        await Assert.ThrowsAsync<InvalidNoticeException>(() => new NoticeTranslationService(translator, TimeProvider.System)
            .TranslateAsync(new(title, body, language is null ? null : [language]), CancellationToken.None));
        Assert.Empty(translator.Requests);
    }

    [Fact]
    public void TheFingerprint_IsStable_AndIgnoresSurroundingWhitespace()
    {
        Assert.Equal(NoticeService.SourceFingerprint("제목", "본문"), NoticeService.SourceFingerprint(" 제목\n", "본문 "));
        Assert.NotEqual(NoticeService.SourceFingerprint("제목", "본문"), NoticeService.SourceFingerprint("제목", "본문2"));
        Assert.Matches("^[0-9a-f]{64}$", NoticeService.SourceFingerprint("a", "b"));
        // The same literal is pinned in apps/admin/tests/adminV2.test.ts (noticeFingerprint): the two implementations must agree.
        Assert.Equal("f75afad82792cfbe649659ebc7b5b48a46aec9f5ccc82db05123da4b0a71414a", NoticeService.SourceFingerprint("점검 안내", "내일 점검합니다"));
    }

    [Fact]
    public void SavingTranslations_FollowsTheOriginRules()
    {
        var fingerprint = NoticeService.SourceFingerprint("제목", "본문");
        NoticeWrite Write(params NoticeText[] texts) => new("Draft", false, false, 7, DateTimeOffset.UnixEpoch.AddYears(56), null, null, texts);
        var korean = new NoticeText("ko", "제목", "본문");

        NoticeService.Validate(Write(korean, new NoticeText("en", "Title", "Body", "Machine", fingerprint)));
        NoticeService.Validate(Write(korean, new NoticeText("en", "Title", "Body", "Manual")));
        NoticeService.Validate(Write(korean with { Origin = "Source" }, new NoticeText("en", "Title", "Body")));
        Assert.Throws<InvalidNoticeException>(() => NoticeService.Validate(Write(korean, new NoticeText("en", "Title", "Body", "Machine"))));
        Assert.Throws<InvalidNoticeException>(() => NoticeService.Validate(Write(korean, new NoticeText("en", "Title", "Body", "Source"))));
        Assert.Throws<InvalidNoticeException>(() => NoticeService.Validate(Write(korean with { Origin = "Machine" }, new NoticeText("en", "Title", "Body"))));
        Assert.Throws<InvalidNoticeException>(() => NoticeService.Validate(Write(korean, new NoticeText("en", "Title", "Body", "Robot"))));
        Assert.Throws<InvalidNoticeException>(() => NoticeService.Validate(Write(korean, new NoticeText("en", "Title", "Body", "Machine", "ABC"))));
    }
}

/// <summary>문의 관리: what reaches the person only ever comes from an explicit, validated send.</summary>
public sealed class AdminInquiryWorkflowServiceTests
{
    private readonly FakeWorkflowStore _store = new();
    private readonly FakeAdminService _admin = new();

    private AdminInquiryWorkflowService Service(ITextTranslator? translator = null, bool allow = true) =>
        new(_admin, _store, translator ?? new ScriptedTranslator(language => [$"[{language}]"]),
            new TranslationOptions { Provider = TranslationOptions.ProviderAzure, AllowInquiryTranslation = allow, AzureTranslator = { Key = "k", Region = "r" } }, TimeProvider.System);

    [Fact]
    public async Task TranslatingTheInquiry_StoresAKoreanCopy_AndTheDetectedLanguage()
    {
        var translator = new ScriptedTranslator(_ => ["앱이 멈춰요"], detected: "en");
        await Service(translator).TranslateContentAsync(7);

        Assert.Equal((7L, "en", "앱이 멈춰요"), _store.ContentTranslation);
        var request = Assert.Single(translator.Requests);
        Assert.Equal((null, "ko", "The app freezes"), (request.SourceLanguage, request.TargetLanguage, request.Texts[0]));
    }

    [Fact]
    public async Task UserText_NeverLeavesWithoutTheExplicitInquirySwitch()
    {
        var translator = new ScriptedTranslator(_ => ["x"]);
        var error = await Assert.ThrowsAsync<TranslationUnavailableException>(() => Service(translator, allow: false).TranslateContentAsync(7));

        Assert.Equal("inquiryTranslationNotAllowed", error.Code);
        Assert.Empty(translator.Requests);
        Assert.False(Service(translator, allow: false).TranslationState.Allowed);
    }

    [Fact]
    public async Task WithoutAProvider_TheAnswerIsNotMachineTranslated()
    {
        var service = new AdminInquiryWorkflowService(_admin, _store, new DisabledTextTranslator(), new TranslationOptions(), TimeProvider.System);
        var error = await Assert.ThrowsAsync<TranslationUnavailableException>(() => service.TranslateAnswerAsync(7, new("답변", "en")));
        Assert.Equal("notConfigured", error.Code);
    }

    [Fact]
    public async Task TheAnswerTranslation_GoesFromKoreanToTheChosenLanguage_AndSavesNothing()
    {
        var translation = await Service().TranslateAnswerAsync(7, new(" 확인했습니다 ", "ja"));

        Assert.Equal(("ja", "[ja]"), (translation.Language, translation.Text));
        Assert.Null(_store.Sent);
        Assert.Null(_store.Draft);
    }

    [Fact]
    public async Task ATranslatedAnswer_IsSentWithItsKoreanOriginal()
    {
        var expected = DateTimeOffset.UnixEpoch;
        await Service().SendAnswerAsync(1, 7, " Fixed. ", " 수정했습니다. ", "en", expected);

        Assert.Equal((7L, "Fixed.", "수정했습니다.", "en", (DateTimeOffset?)expected, 1L), _store.Sent);
    }

    [Fact]
    public async Task AKoreanAnswer_IsItsOwnSource()
    {
        await Service().SendAnswerAsync(1, 7, "확인했습니다", null, "ko", DateTimeOffset.UnixEpoch);
        Assert.Equal(("확인했습니다", "확인했습니다", "ko"), (_store.Sent!.Value.Delivered, _store.Sent.Value.SourceKo, _store.Sent.Value.Language));
    }

    [Theory]
    [InlineData("Fixed.", null, "en", "sourceKo")]
    [InlineData("Fixed.", "수정", "xx", "language")]
    [InlineData("", "수정", "en", "answer")]
    [InlineData("다른 문장", "수정", "ko", "answer")]
    public async Task AnUnsafeSend_IsRefused_AndNothingIsWritten(string answer, string? sourceKo, string language, string field)
    {
        var error = await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().SendAnswerAsync(1, 7, answer, sourceKo, language, DateTimeOffset.UnixEpoch));

        Assert.Equal(field, error.Field);
        Assert.Null(_store.Sent);
    }

    [Fact]
    public async Task ASendWithoutTheLoadedChangeToken_IsRefused()
    {
        var error = await Assert.ThrowsAsync<InvalidAdminRequestException>(() => Service().SendAnswerAsync(1, 7, "Fixed.", "수정", "en", null));
        Assert.Equal("expectedUpdatedAtUtc", error.Field);
        Assert.Null(_store.Sent);
    }

    [Fact]
    public async Task ASendOverAChangedInquiry_IsAConflict()
    {
        _store.Outcome = AdminInquiryAnswerOutcome.Changed;
        await Assert.ThrowsAsync<AdminInquiryChangedException>(() => Service().SendAnswerAsync(1, 7, "Fixed.", "수정", "en", DateTimeOffset.UnixEpoch));
    }

    [Fact]
    public async Task TheDraft_KeepsKoreanTranslationAndLanguage()
    {
        await Service().SaveDraftAsync(7, new(" 초안 ", " Draft ", "en"));
        Assert.Equal(("초안", "Draft", "en"), _store.Draft);
    }

    private sealed class FakeWorkflowStore : IAdminInquiryWorkflowStore
    {
        public (long Id, string? Language, string Text)? ContentTranslation { get; private set; }

        public (string? SourceKo, string? Translated, string? Language)? Draft { get; private set; }

        public (long Id, string Delivered, string SourceKo, string Language, DateTimeOffset? Expected, long Admin)? Sent { get; private set; }

        public AdminInquiryAnswerOutcome Outcome { get; set; } = AdminInquiryAnswerOutcome.Answered;

        public Task<string?> GetContentAsync(long inquiryId, CancellationToken cancellationToken = default) => Task.FromResult<string?>("The app freezes");

        public Task<bool> RecordContentTranslationAsync(long inquiryId, string? detectedLanguage, string translationKo, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            ContentTranslation = (inquiryId, detectedLanguage, translationKo);
            return Task.FromResult(true);
        }

        public Task<bool> SaveDraftAsync(long inquiryId, string? sourceKo, string? translated, string? language, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Draft = (sourceKo, translated, language);
            return Task.FromResult(true);
        }

        public Task<AdminInquiryAnswerOutcome> SendAnswerAsync(long inquiryId, string delivered, string sourceKo, string language, DateTimeOffset? expectedUpdatedAtUtc,
            long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            if (Outcome == AdminInquiryAnswerOutcome.Answered)
            {
                Sent = (inquiryId, delivered, sourceKo, language, expectedUpdatedAtUtc, adminUserId);
            }

            return Task.FromResult(Outcome);
        }
    }

    private sealed class FakeAdminService : IAdminService
    {
        public Task<AdminDashboardSummary> GetDashboardSummaryAsync(DateTimeOffset? todayStartUtc, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<AdminUserPage> ListUsersAsync(string? jupleId, long? cursor, int? limit, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<AdminInquiryPage> ListInquiriesAsync(string? status, long? cursor, int? limit, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<AdminInquiryDetail> GetInquiryAsync(long inquiryId, CancellationToken cancellationToken = default) =>
            Task.FromResult(new AdminInquiryDetail(inquiryId, "Pending", "Bug", null, "c", null, DateTimeOffset.UnixEpoch, null, null, new(null, null, null, null, null, null), []));

        public Task<AdminInquiryDetail> ChangeInquiryStatusAsync(long adminUserId, long inquiryId, string? status, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<AdminInquiryDetail> AnswerInquiryAsync(long adminUserId, long inquiryId, string? answer, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }
}

/// <summary>A translator whose answers a test chooses per target language; records every request.</summary>
internal sealed class ScriptedTranslator(Func<string, string[]> answer, string? detected = null) : ITextTranslator
{
    public List<TranslationRequest> Requests { get; } = [];

    public string ProviderName => "Scripted";

    public bool IsConfigured => true;

    public Task<TranslationResult> TranslateAsync(TranslationRequest request, CancellationToken cancellationToken = default)
    {
        lock (Requests)
        {
            Requests.Add(request);
        }

        return Task.FromResult(new TranslationResult(answer(request.TargetLanguage), detected));
    }
}
