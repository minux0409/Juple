using Juple.Application.Support;
using Juple.Application.Translation;

namespace Juple.Application.Admin;

public sealed record AdminInquiryDraftRequest(string? SourceKo, string? Translated, string? Language);

public sealed record AdminInquiryAnswerTranslationRequest(string? SourceKo, string? Language);

public sealed record AdminInquiryAnswerTranslation(string Language, string Text, string Provider);

/// <summary>
/// 문의 관리's translation workflow on the EXISTING inquiry row: the person's text in Korean (Content itself never changes), an
/// unsent draft (Korean + translation), the answer's translation and the final send. Machine translation needs a provider AND
/// Translation:AllowInquiryTranslation (user text is personal data). Without them the admin can still write the translation
/// by hand - nothing is ever marked as machine-translated that was not.
/// </summary>
public sealed class AdminInquiryWorkflowService(
    IAdminService adminService,
    IAdminInquiryWorkflowStore store,
    ITextTranslator translator,
    TranslationOptions options,
    TimeProvider timeProvider)
{
    public AdminInquiryTranslationState TranslationState =>
        new(translator.ProviderName, translator.IsConfigured, translator.IsConfigured && options.AllowInquiryTranslation);

    public async Task<AdminInquiryDetail> TranslateContentAsync(long inquiryId, CancellationToken cancellationToken = default)
    {
        RequireMachineTranslation();
        var content = await store.GetContentAsync(inquiryId, cancellationToken) ?? throw new AdminInquiryNotFoundException();
        var result = await translator.TranslateAsync(new TranslationRequest([content], null, TranslationLanguages.Korean), cancellationToken);
        var detected = TranslationLanguages.FromLocale(result.DetectedLanguage);
        var text = result.Texts[0].Trim();
        if (text.Length is 0 or > SupportInquiryService.MaxAnswerLength)
        {
            throw new TranslationUnavailableException("invalidResponse");
        }

        if (!await store.RecordContentTranslationAsync(inquiryId, detected, text, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminInquiryNotFoundException();
        }

        return await adminService.GetInquiryAsync(inquiryId, cancellationToken);
    }

    public async Task<AdminInquiryDetail> SaveDraftAsync(long inquiryId, AdminInquiryDraftRequest request, CancellationToken cancellationToken = default)
    {
        var sourceKo = Bounded(request.SourceKo, "sourceKo");
        var translated = Bounded(request.Translated, "translated");
        var language = request.Language is null ? null : Language(request.Language);
        if (!await store.SaveDraftAsync(inquiryId, sourceKo, translated, language, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminInquiryNotFoundException();
        }

        return await adminService.GetInquiryAsync(inquiryId, cancellationToken);
    }

    public async Task<AdminInquiryAnswerTranslation> TranslateAnswerAsync(long inquiryId, AdminInquiryAnswerTranslationRequest request, CancellationToken cancellationToken = default)
    {
        var sourceKo = Bounded(request.SourceKo, "sourceKo") ?? throw new InvalidAdminRequestException("sourceKo", "Write the Korean answer first.");
        var language = Language(request.Language);
        if (language == TranslationLanguages.Korean)
        {
            throw new InvalidAdminRequestException("language", "A Korean answer needs no translation.");
        }

        RequireMachineTranslation();
        _ = await store.GetContentAsync(inquiryId, cancellationToken) ?? throw new AdminInquiryNotFoundException();
        var result = await translator.TranslateAsync(new TranslationRequest([sourceKo], TranslationLanguages.Korean, language), cancellationToken);
        var text = result.Texts[0].Trim();
        if (text.Length is 0 or > SupportInquiryService.MaxAnswerLength)
        {
            throw new TranslationUnavailableException("invalidResponse");
        }

        return new AdminInquiryAnswerTranslation(language, text, translator.ProviderName);
    }

    /// <summary>
    /// Sends the answer: <paramref name="answer"/> is exactly what the person will read (in <paramref name="language"/>), sourceKo
    /// the Korean original kept for support. A non-Korean answer must come with its Korean source. expectedUpdatedAtUtc (the
    /// inquiry's UpdatedAtUtc as the admin last loaded it) stops a send over a change made meanwhile; resending the same answer
    /// writes nothing.
    /// </summary>
    public async Task<AdminInquiryDetail> SendAnswerAsync(
        long adminUserId,
        long inquiryId,
        string? answer,
        string? sourceKo,
        string? language,
        DateTimeOffset? expectedUpdatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var delivered = Bounded(answer, "answer") ?? throw new InvalidAdminRequestException("answer", "answer is required.");
        var target = Language(language);
        if (expectedUpdatedAtUtc is null)
        {
            throw new InvalidAdminRequestException("expectedUpdatedAtUtc", "Send the inquiry's changeToken as loaded.");
        }
        var korean = Bounded(sourceKo, "sourceKo");
        if (korean is null)
        {
            if (target != TranslationLanguages.Korean)
            {
                throw new InvalidAdminRequestException("sourceKo", "A translated answer needs its Korean original.");
            }

            korean = delivered;
        }
        else if (target == TranslationLanguages.Korean && korean != delivered)
        {
            throw new InvalidAdminRequestException("answer", "A Korean answer is sent exactly as written.");
        }

        var outcome = await store.SendAnswerAsync(inquiryId, delivered, korean, target, expectedUpdatedAtUtc, adminUserId, timeProvider.GetUtcNow(), cancellationToken);
        return outcome switch
        {
            AdminInquiryAnswerOutcome.NotFound => throw new AdminInquiryNotFoundException(),
            AdminInquiryAnswerOutcome.Changed => throw new AdminInquiryChangedException(),
            _ => await adminService.GetInquiryAsync(inquiryId, cancellationToken),
        };
    }

    private void RequireMachineTranslation()
    {
        if (!translator.IsConfigured)
        {
            throw new TranslationUnavailableException("notConfigured");
        }

        if (!options.AllowInquiryTranslation)
        {
            throw new TranslationUnavailableException("inquiryTranslationNotAllowed");
        }
    }

    private static string Language(string? value) =>
        TranslationLanguages.IsSupported(value) ? value! : throw new InvalidAdminRequestException("language", "Use one of Juple's languages.");

    private static string? Bounded(string? value, string field)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length <= SupportInquiryService.MaxAnswerLength
            ? trimmed
            : throw new InvalidAdminRequestException(field, $"{field} must be at most {SupportInquiryService.MaxAnswerLength} characters.");
    }
}

/// <summary>The inquiry changed (answered, or status changed) after the admin loaded it - reload before sending.</summary>
public sealed class AdminInquiryChangedException : Exception;
