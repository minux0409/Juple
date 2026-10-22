using Juple.Infrastructure;
using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Diagnostics;
using Juple.Api.Warmup;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Juple.Api.Public;
using System.Threading.RateLimiting;
using Juple.Api.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.SharePassword;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.AddItemToCollections;
using Juple.Application.Collections.CreateCollection;
using Juple.Application.Collections.DeleteCollection;
using Juple.Application.Collections.RestoreCollection;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.GetCollectionDetail;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.GetCollectionShare;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.MoveCollectionItem;
using Juple.Application.Collections.MergeCollections;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Collections.RenameCollection;
using Juple.Application.Collections.RevokeCollectionShare;
using Juple.Application.Collections.SetCollectionColor;
using Juple.Application.Collections.SetCollectionFavorite;
using Juple.Application.Collections.NotificationPreference;
using Juple.Application.Collections.CopyItems;
using Juple.Application.Collections.SetCollectionIcon;
using Juple.Application.Collections.SetCollectionIconImage;
using Juple.Application.Collections.TransferCollectionItem;
using Juple.Application.Collections.UndoMergeCollections;
using Juple.Application.Collections.UndoTransferCollectionItem;
using Juple.Application.Identity;
using Juple.Application.Images.BlobCleanup;
using Juple.Application.Images.DeleteItemImage;
using Juple.Application.Images.ListItemImages;
using Juple.Application.Images.UploadItemImage;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.Items.DeleteAllRecentlyOpenedLinks;
using Juple.Application.Items.DeleteItem;
using Juple.Application.Items.DeleteRecentlyOpenedLink;
using Juple.Application.Items.EmptyItemTrash;
using Juple.Application.Items.GetItemDetail;
using Juple.Application.Items.GetItemHistory;
using Juple.Application.Items.GetItemHistoryByDate;
using Juple.Application.Items.GetItemTrash;
using Juple.Application.Items.GetRecentlyOpenedLinks;
using Juple.Application.Items.InstagramMetadataCandidate;
using Juple.Application.Items.InstagramMetadataRetry;
using Juple.Application.Items.PermanentlyDeleteItem;
using Juple.Application.Items.RecordItemOpen;
using Juple.Application.Items.RestoreItem;
using Juple.Application.Items.SetItemCoverImage;
using Juple.Application.Items.SetItemPreviewImage;
using Juple.Application.Items.UpdateItemDetails;
using Juple.Application.Notifications;
using Juple.Application.Push.RegisterPushDevice;
using Juple.Application.Push.UnregisterPushDevice;
using Juple.Application.UrlMetadata.PreviewInstagramMetadataCandidate;
using Juple.Application.UrlMetadata.ResolveUrlMetadata;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Application.Users.DeleteAccount;
using Juple.Application.Users.Profile;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

// Decided this early (before any config validation below) because this one-shot execution mode has
// genuinely different configuration requirements from the HTTP API: it does not authenticate a
// request - it runs entirely outside UseAuthentication/UseAuthorization/MapControllers (see the
// early-return branch further down) - so it has no legitimate need for Entra config at all. Only
// the actual HTTP API path keeps the existing fail-fast below unchanged.
//
// --run-push-dispatch: one pass of the social Push outbox (friend requests, Collection invitations
// and the data-only refresh signals - see DispatchPendingPushNotificationsService). Only this Job
// holds the Firebase credential; the HTTP API never sends Push itself, it only writes the outbox.
var isPushDispatchJob = args.Contains("--run-push-dispatch", StringComparer.Ordinal);
var isBlobCleanupRetryJob = args.Contains("--run-blob-cleanup-retry", StringComparer.Ordinal);
var isInstagramMetadataRetryJob = args.Contains("--run-instagram-metadata-retry", StringComparer.Ordinal);
// --run-billing-reconcile: one bounded pass of the Google billing sweep (events whose wake-up was lost, purchases whose periodic
// re-check is due). --run-billing-worker: the long-running billing-events consumer. Neither authenticates a request.
var isBillingReconcileJob = args.Contains("--run-billing-reconcile", StringComparer.Ordinal);
var isBillingWorker = args.Contains("--run-billing-worker", StringComparer.Ordinal);
// --run-retention-cleanup: one bounded pass of the data-retention cleanup (docs/data-retention.md). No request, no credential beyond SQL and Blob Storage.
var isRetentionCleanupJob = args.Contains("--run-retention-cleanup", StringComparer.Ordinal);
var isExpenseSyncJob = args.Contains("--run-expense-sync", StringComparer.Ordinal);
var isAzureCostSyncJob = args.Contains("--run-azure-cost-sync", StringComparer.Ordinal);
var isOneShotJob = isPushDispatchJob || isBlobCleanupRetryJob || isInstagramMetadataRetryJob || isBillingReconcileJob || isRetentionCleanupJob || isExpenseSyncJob || isAzureCostSyncJob;
// --run-notification-worker: the long-running notification worker (Service Bus consumer - see
// NotificationWorkerService). Like the Jobs it authenticates no request and runs no controllers; it
// serves only /health. Only it and the push-dispatch Job hold the Firebase credential.
var isNotificationWorker = args.Contains("--run-notification-worker", StringComparer.Ordinal);
var isOutsideHttpApi = isOneShotJob || isNotificationWorker || isBillingWorker;

// Never required, and never validated, for either Job - RequireScope still needs a non-null value
// to register the policy below, but that policy is only ever evaluated by the ASP.NET Core
// request pipeline neither Job runs.
var requiredScope = isOutsideHttpApi
    ? string.Empty
    : builder.Configuration["Authentication:EntraExternalId:RequiredScope"]
        ?? throw new InvalidOperationException("Authentication:EntraExternalId:RequiredScope must be configured.");

builder.Services.AddInfrastructure(builder.Configuration);
if (isNotificationWorker)
{
    builder.Services.AddHostedService<Juple.Api.Notifications.NotificationWorkerService>();
}

if (!isOutsideHttpApi
    && !string.IsNullOrWhiteSpace(builder.Configuration[$"{NotificationPipelineOptions.SectionName}:ServiceBusNamespace"]))
{
    // Sends the committed outbox events' wake-up signals to Service Bus in the background (the
    // requests only hand them to an in-process channel - see NotificationSignalPump).
    builder.Services.AddHostedService<Juple.Api.Notifications.NotificationSignalPublisherService>();
}

if (!isOutsideHttpApi)
{
    // HTTP API only: the start-up warm-up (off unless StartupWarmup:Enabled). It runs right after the host starts - never before the
    // listener, so /health (liveness) answers throughout - and /health/ready turns healthy when it is done. See StartupWarmupRunner.
    builder.Services.Configure<StartupWarmupOptions>(builder.Configuration.GetSection(StartupWarmupOptions.SectionName));
    builder.Services.AddSingleton<StartupWarmupState>();
    builder.Services.AddSingleton<IStartupWarmupTask, AuthMetadataWarmupTask>();
    builder.Services.AddSingleton<IStartupWarmupTask, EfModelWarmupTask>();
    builder.Services.AddSingleton<IStartupWarmupTask, ConnectionPoolWarmupTask>();
    builder.Services.AddSingleton<IStartupWarmupTask, QueryCompilationWarmupTask>();
    builder.Services.AddSingleton<StartupWarmupRunner>();
    builder.Services.AddHostedService<StartupWarmupHostedService>();
}

if (!isOutsideHttpApi)
{
    // HTTP API only: daily activity for analytics (docs/analytics.md) - requests hand a key to the pump, its background loop writes
    // at most one row per person, UTC day and platform.
    builder.Services.AddSingleton<Juple.Infrastructure.Analytics.UserActivityPump>();
    builder.Services.AddHostedService<Juple.Api.Analytics.UserActivityRecorderService>();
}

if (!isOutsideHttpApi)
{
    // HTTP API only: fetch the Blob User Delegation Key in the background right after start, so the
    // first image read URL does not wait for it (see UserDelegationKeyWarmupService). The one-shot
    // Jobs never start the host anyway - this keeps them out of it explicitly.
    builder.Services.AddHostedService<Juple.Api.Storage.UserDelegationKeyWarmupService>();
}
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IExternalIdentityAccessor, HttpContextExternalIdentityAccessor>();
builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
// The subscription program switch (default OFF - nobody restricted, no trial consumed). Validated at API startup below.
var billingOptions = builder.Configuration.GetSection("Billing").Get<Juple.Application.Billing.BillingOptions>() ?? new Juple.Application.Billing.BillingOptions();
builder.Services.AddSingleton(billingOptions);
// The person's own data export: off by default (the endpoints answer 404 and the apps show no entry); an invalid limit stops the API.
var dataExportOptions = builder.Configuration.GetSection(Juple.Application.DataExport.DataExportOptions.SectionName).Get<Juple.Application.DataExport.DataExportOptions>()
    ?? new Juple.Application.DataExport.DataExportOptions();
if (dataExportOptions.Validate() is { } dataExportOptionsError)
{
    throw new InvalidOperationException(dataExportOptionsError);
}

builder.Services.AddSingleton(dataExportOptions);
{
    // A half-configured Entra account deletion would silently never delete the sign-in account: refuse to start instead.
    var entraDeletionOptionsError = (builder.Configuration.GetSection(Juple.Application.Users.DeleteAccount.EntraAccountDeletionOptions.SectionName)
        .Get<Juple.Application.Users.DeleteAccount.EntraAccountDeletionOptions>() ?? new()).Validate();
    if (entraDeletionOptionsError is not null)
    {
        throw new InvalidOperationException(entraDeletionOptionsError);
    }
}
if (isBillingWorker)
{
    // Enabled: the billing-events consumer. Disabled: an idle placeholder - no Service Bus processor, Google client or key is built.
    Juple.Api.Billing.BillingRuntimeActivation.AddBillingWorker(builder.Services, billingOptions);
}
builder.Services.AddScoped<Juple.Application.Billing.ITrialIdentityHasher, Juple.Application.Billing.TrialIdentityHasher>();
builder.Services.AddScoped<Juple.Application.Billing.IEntitlementService, Juple.Application.Billing.EntitlementService>();
builder.Services.AddScoped<Juple.Application.Billing.IDataRetentionService, Juple.Application.Billing.DataRetentionService>();
builder.Services.AddSingleton<Juple.Application.Billing.IPurchaseTokenProtector, Juple.Application.Billing.PurchaseTokenProtector>();
builder.Services.AddSingleton<Juple.Application.Billing.GooglePlay.IGoogleAccountIdProvider, Juple.Application.Billing.GooglePlay.GoogleAccountIdProvider>();
builder.Services.AddScoped<Juple.Application.Billing.GooglePlay.IGoogleBillingService, Juple.Application.Billing.GooglePlay.GoogleBillingService>();
builder.Services.AddScoped<Juple.Application.Billing.GooglePlay.IGoogleBillingProcessor, Juple.Application.Billing.GooglePlay.GoogleBillingProcessor>();
builder.Services.AddScoped<ICurrentUserBootstrapService, CurrentUserBootstrapService>();
builder.Services.AddScoped<IDeleteAccountService, DeleteAccountService>();
builder.Services.AddScoped<IInboxEntrySaveService, InboxEntrySaveService>();
builder.Services.AddScoped<Juple.Application.Support.ISupportInquiryService, Juple.Application.Support.SupportInquiryService>();
builder.Services.AddScoped<Juple.Application.Admin.IAdminService, Juple.Application.Admin.AdminService>();
builder.Services.AddScoped<Juple.Application.Admin.IAdminAnalyticsService, Juple.Application.Admin.AdminAnalyticsService>();
builder.Services.AddSingleton(new Juple.Application.Safety.TermsOptions
{
    CurrentVersion = builder.Configuration["Terms:CurrentVersion"] is { Length: > 0 } termsVersion ? termsVersion : Juple.Application.Safety.TermsOptions.DefaultVersion,
    EnforceAcceptance = builder.Configuration.GetValue("Terms:EnforceAcceptance", true),
});
builder.Services.AddScoped<Juple.Application.Safety.ITermsConsentService, Juple.Application.Safety.TermsConsentService>();
builder.Services.AddScoped<Juple.Application.Safety.IReportService, Juple.Application.Safety.ReportService>();
builder.Services.AddScoped<Juple.Application.Safety.IUserBlockService, Juple.Application.Safety.UserBlockService>();
builder.Services.AddScoped<Juple.Application.Safety.IUserBlockPolicy, Juple.Application.Safety.UserBlockPolicy>();
builder.Services.AddScoped<Juple.Application.Items.GetItemDetail.IItemCollectionContextGate, Juple.Application.Items.GetItemDetail.ItemCollectionContextGate>();
builder.Services.AddScoped<ISaveInboxEntryToCollectionsService, SaveInboxEntryToCollectionsService>();
builder.Services.AddSingleton<Juple.Application.Collections.Public.ICollectionShareUrlDetector, Juple.Api.Configuration.ConfiguredCollectionShareUrlDetector>();
builder.Services.AddScoped<IGetItemHistoryService, GetItemHistoryService>();
builder.Services.AddScoped<IGetItemHistoryByDateService, GetItemHistoryByDateService>();
builder.Services.AddScoped<Juple.Application.Items.GetItemHistorySections.IGetItemHistorySectionsService, Juple.Application.Items.GetItemHistorySections.GetItemHistorySectionsService>();
builder.Services.AddScoped<IRecordItemOpenService, RecordItemOpenService>();
builder.Services.AddScoped<IGetRecentlyOpenedLinksService, GetRecentlyOpenedLinksService>();
builder.Services.AddScoped<IDeleteRecentlyOpenedLinkService, DeleteRecentlyOpenedLinkService>();
builder.Services.AddScoped<IDeleteAllRecentlyOpenedLinksService, DeleteAllRecentlyOpenedLinksService>();
builder.Services.AddScoped<IDeleteItemService, DeleteItemService>();
builder.Services.AddScoped<IUpdateItemDetailsService, UpdateItemDetailsService>();
builder.Services.AddScoped<ISetItemPreviewImageService, SetItemPreviewImageService>();
builder.Services.AddScoped<IApplyInstagramMetadataCandidateService, ApplyInstagramMetadataCandidateService>();
builder.Services.AddScoped<ISetItemCoverImageService, SetItemCoverImageService>();
builder.Services.AddScoped<IGetItemDetailService, GetItemDetailService>();
builder.Services.AddScoped<IGetItemTrashService, GetItemTrashService>();
builder.Services.AddScoped<IRestoreItemService, RestoreItemService>();
builder.Services.AddScoped<IPermanentlyDeleteItemService, PermanentlyDeleteItemService>();
builder.Services.AddScoped<IEmptyItemTrashService, EmptyItemTrashService>();
builder.Services.AddScoped<IListCollectionsService, ListCollectionsService>();
builder.Services.AddScoped<CollectionSearchSuggestionsService>();
builder.Services.AddScoped<Juple.Application.Collections.HomeSummary.IHomeCollectionsSummaryService, Juple.Application.Collections.HomeSummary.HomeCollectionsSummaryService>();
builder.Services.AddScoped<ICreateCollectionService, CreateCollectionService>();
builder.Services.AddScoped<IGetCollectionDetailService, GetCollectionDetailService>();
builder.Services.AddScoped<IRenameCollectionService, RenameCollectionService>();
builder.Services.AddScoped<ISetCollectionFavoriteService, SetCollectionFavoriteService>();
builder.Services.AddScoped<ICollectionNotificationPreferenceService, CollectionNotificationPreferenceService>();
builder.Services.AddScoped<ICopyCollectionItemsService, CopyCollectionItemsService>();
builder.Services.AddScoped<ISetCollectionIconService, SetCollectionIconService>();
builder.Services.AddScoped<ISetCollectionIconImageService, SetCollectionIconImageService>();
builder.Services.AddScoped<ISetCollectionColorService, SetCollectionColorService>();
builder.Services.AddScoped<IDeleteCollectionService, DeleteCollectionService>();
builder.Services.AddScoped<IRestoreCollectionService, RestoreCollectionService>();
builder.Services.AddScoped<IGetCollectionItemsService, GetCollectionItemsService>();
builder.Services.AddScoped<IGetCollectionItemSectionsService, GetCollectionItemSectionsService>();
builder.Services.AddScoped<IAddItemToCollectionService, AddItemToCollectionService>();
builder.Services.AddScoped<IAddItemToCollectionsService, AddItemToCollectionsService>();
builder.Services.AddScoped<IRemoveItemFromCollectionService, RemoveItemFromCollectionService>();
builder.Services.AddScoped<IMoveCollectionItemService, MoveCollectionItemService>();
builder.Services.AddScoped<ITransferCollectionItemService, TransferCollectionItemService>();
builder.Services.AddScoped<IUndoTransferCollectionItemService, UndoTransferCollectionItemService>();
builder.Services.AddScoped<IMergeCollectionsService, MergeCollectionsService>();
builder.Services.AddScoped<IUndoMergeCollectionsService, UndoMergeCollectionsService>();
builder.Services.AddScoped<IEnableCollectionShareService, EnableCollectionShareService>();
builder.Services.AddScoped<IGetCollectionShareService, GetCollectionShareService>();
builder.Services.AddScoped<IGetCollectionShareLinkService, GetCollectionShareLinkService>();
builder.Services.AddScoped<Juple.Application.Collections.ShareLink.IShareCollectionLinkService, Juple.Application.Collections.ShareLink.ShareCollectionLinkService>();
builder.Services.AddScoped<Juple.Application.Collections.Submissions.ICollectionLinkSubmissionService, Juple.Application.Collections.Submissions.CollectionLinkSubmissionService>();
builder.Services.AddScoped<Juple.Application.Collections.Reactions.ICollectionItemReactionService, Juple.Application.Collections.Reactions.CollectionItemReactionService>();
builder.Services.AddScoped<Juple.Application.Collections.Comments.ICollectionItemCommentService, Juple.Application.Collections.Comments.CollectionItemCommentService>();
builder.Services.AddScoped<IRevokeCollectionShareService, RevokeCollectionShareService>();
builder.Services.AddScoped<IPublicCollectionService, PublicCollectionService>();
builder.Services.AddScoped<IPublicCollectionWriteService, PublicCollectionWriteService>();
// Collaboration / lock (see CollectionAccess for the Owner/Contributor policy and
// ICollectionUnlockTokenProtector for the stateless, replica-safe unlock grants).
builder.Services.AddScoped<ICollectionAccessService, CollectionAccessService>();
builder.Services.AddScoped<ICollectionLockService, CollectionLockService>();
builder.Services.AddScoped<ICollectionLockPasswordService, CollectionLockPasswordService>();
builder.Services.AddScoped<CollectionPasswordVerifier>();
builder.Services.AddScoped<ICollectionCollaborationService, CollectionCollaborationService>();
builder.Services.AddScoped<Juple.Application.Collections.Join.ICollectionJoinService, Juple.Application.Collections.Join.CollectionJoinService>();
builder.Services.AddScoped<IUserProfileService, UserProfileService>();
builder.Services.AddScoped<Juple.Application.Friends.IFriendService, Juple.Application.Friends.FriendService>();
builder.Services.AddScoped<Juple.Application.Friends.IFriendSharedCollectionsService, Juple.Application.Friends.FriendSharedCollectionsService>();
builder.Services.AddSingleton<ICollectionLockPasswordHasher, CollectionLockPasswordHasher>();
builder.Services.AddSingleton<ICollectionUnlockTokenProtector, CollectionUnlockTokenProtector>();
builder.Services.AddSingleton<ICollectionSharePasswordProtector, CollectionSharePasswordProtector>();
builder.Services.AddScoped<ICollectionSharePasswordService, CollectionSharePasswordService>();
builder.Services.Configure<PublicWebOptions>(builder.Configuration.GetSection("PublicWeb"));
// Per-request timing log (route template, status, elapsed, SQL totals). OFF unless RequestTiming:Enabled - see RequestTimingMiddleware.
builder.Services.Configure<RequestTimingOptions>(builder.Configuration.GetSection(RequestTimingOptions.SectionName));
builder.Services.Configure<MobileVersionPolicyOptions>(builder.Configuration.GetSection("MobileVersionPolicy"));
// A broken policy would tell users to update to nothing (or block them). It must not take the whole API down either (a bad value in a
// one-line setting is not a reason for every user to lose the service), so each broken platform is treated as "no policy" - nobody is
// prompted or blocked - and the problem is logged loudly at startup. The deployment templates reject such values during validation
// (infra/azure/app/mobile-version-policy-guard.bicep), so this is only the last line of defence.
builder.Services.PostConfigure<MobileVersionPolicyOptions>(policy =>
{
    foreach (var (name, platform) in new[] { ("Android", policy.Android), ("Ios", policy.Ios) })
    {
        var problem = platform.Validate(name);
        if (problem is null)
        {
            continue;
        }

        Console.Error.WriteLine($"MobileVersionPolicy ignored for {name}: {problem}");
        platform.LatestBuild = 0;
        platform.MinimumSupportedBuild = 0;
        platform.StoreUrl = null;
    }
});
builder.Services.Configure<PublicCollectionCursorOptions>(
    builder.Configuration.GetSection("PublicCollectionCursor"));
builder.Services.Configure<CollectionUnlockGrantOptions>(
    builder.Configuration.GetSection("CollectionUnlockGrant"));
builder.Services.Configure<CollectionSharePasswordOptions>(
    builder.Configuration.GetSection("CollectionSharePassword"));
builder.Services.AddSingleton<IPublicCollectionItemPageCursorCodec, PublicCollectionItemPageCursorCodec>();
builder.Services.AddScoped<IRegisterPushDeviceService, RegisterPushDeviceService>();
builder.Services.AddScoped<IDispatchPendingPushNotificationsService, DispatchPendingPushNotificationsService>();
builder.Services.AddScoped<Juple.Application.Notifications.Inbox.INotificationInboxService, Juple.Application.Notifications.Inbox.NotificationInboxService>();
builder.Services.AddScoped<IUnregisterPushDeviceService, UnregisterPushDeviceService>();
builder.Services.AddScoped<IListItemImagesService, ListItemImagesService>();
builder.Services.AddScoped<IUploadItemImageService, UploadItemImageService>();
builder.Services.AddScoped<IDeleteItemImageService, DeleteItemImageService>();
builder.Services.AddScoped<IResolveUrlMetadataService, ResolveUrlMetadataService>();
builder.Services.AddScoped<IPreviewInstagramMetadataCandidateService, PreviewInstagramMetadataCandidateService>();
if (!isOutsideHttpApi)
{
    // HTTP API only. WebApplication adds the authentication middleware on its own whenever an
    // authentication scheme is registered - in the notification worker (which serves only /health and
    // has no Entra configuration) that would make every request, the health probe included, fail
    // while building the JWT options. The one-shot Jobs never serve HTTP at all.
    builder.Services
        .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApi(
            builder.Configuration.GetSection("Authentication:EntraExternalId"));
}

// JupleUser for every signed-in endpoint; JupleAdmin for api/v1/admin (JupleUser + an active grant in admin.AdminUsers, checked by
// ActiveAdminAuthorizationHandler against the database for every request - never a client-sent role).
builder.Services.AddAuthorizationBuilder().AddJuplePolicies(requiredScope);
builder.Services.AddScoped<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, ActiveAdminAuthorizationHandler>();

// A block between two people stops an interaction wherever a service raises UserBlockedException (comments, hearts, reactions, invitations,
// joins): one mapping for all controllers instead of a catch in each.
builder.Services.AddSingleton<Juple.Api.Safety.TermsAcceptanceCache>();
builder.Services.AddControllers(options =>
{
    options.Filters.Add<RequestCapacityExceptionFilter>();
    options.Filters.Add<Juple.Api.Safety.UserBlockedExceptionFilter>();
    // Every authenticated endpoint needs the current Terms (Agreement screen after sign-in); the allowlist is AllowWithoutTermsAcceptance.
    options.Filters.Add<Juple.Api.Safety.RequireTermsAcceptanceFilter>();
});
builder.Services.AddProblemDetails();
var requestProtectionOptions = builder.Configuration.GetSection(RequestProtectionOptions.SectionName).Get<RequestProtectionOptions>() ?? new();
requestProtectionOptions.Validate();
builder.Services.AddRequestTimeouts(options => options.AddPolicy(RequestProtection.ImageTimeoutPolicy,
    TimeSpan.FromSeconds(requestProtectionOptions.ImageRequestTimeoutSeconds)));

// First rate limiting in this API (built into ASP.NET Core - no package). These in-process
// limiters are a per-replica first line only; the brute-force guarantee for lock passwords is the
// persisted, cross-replica CollectionUnlockThrottle, and Juple ID enumeration is additionally
// bounded by the 31^8 code space. Partitioned per signed-in identity (tenant+object id) for the
// authenticated endpoints, per share link for the anonymous public unlock.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    RequestProtection.Configure(options, requestProtectionOptions);
    RateLimitPolicies.ConfigureEndpointPolicies(options);
});
var healthChecks = builder.Services.AddHealthChecks();
if (!isOutsideHttpApi)
{
    // Readiness (/health/ready) is the start-up warm-up's state. Tagged "ready" so the liveness endpoint /health - which keeps its
    // meaning "the process answers" - never runs it.
    healthChecks.AddCheck<StartupWarmupReadinessCheck>("startup-warmup", tags: ["ready"]);
}
builder.Services.AddOpenApi();

// PublicWeb: scoped to PublicCollectionsController alone (see its [EnableCors] attribute). Left with
// no allowed origins (WithOrigins requires at least one non-empty value) until PublicWeb:BaseUrl
// is actually configured, so an unconfigured environment allows no cross-origin browser calls
// rather than silently allowing everything.
//
// Default policy: the signed-in Juple Web app (see AuthenticatedWebCors) - only the configured
// AuthenticatedWeb:AllowedOrigins, never any origin, never credentials. Nothing configured (every
// environment that has not deployed the signed-in Web app) = no cross-origin access, as before.
var publicWebBaseUrl = builder.Configuration["PublicWeb:BaseUrl"];
var authenticatedWebOrigins = AuthenticatedWebCors.NormalizeOrigins(
    builder.Configuration.GetSection(AuthenticatedWebCors.AllowedOriginsSection).Get<string?[]>() ?? []);
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(AuthenticatedWebCors.BuildPolicy(authenticatedWebOrigins));
    options.AddPolicy(CorsPolicies.PublicWeb, policy =>
    {
        if (!string.IsNullOrWhiteSpace(publicWebBaseUrl))
        {
            policy.WithOrigins(publicWebBaseUrl).WithMethods("GET").AllowAnyHeader().WithExposedHeaders("Retry-After");
        }
    });
});

var app = builder.Build();

// Google billing settings are checked in EVERY mode (API, worker, Jobs): disabled needs nothing; enabled needs all of its settings and
// three distinct secrets, or the process stops here naming the setting (never echoing a value).
Juple.Application.Billing.BillingOptionsValidator.ValidateGoogle(billingOptions);

// One-shot execution mode for the push-dispatch Job - never reaches the HTTP pipeline below.
if (isPushDispatchJob)
{
    return await RunPushDispatchOnceAsync(app.Services);
}

// The notification worker: its hosted service consumes the queues until shutdown; the only endpoint
// is /health (no authentication, no controllers). Without a Service Bus namespace there is nothing to
// consume - a misconfiguration, so it refuses to start rather than idling silently.
if (isNotificationWorker)
{
    if (string.IsNullOrWhiteSpace(app.Services.GetRequiredService<NotificationPipelineOptions>().ServiceBusNamespace))
    {
        throw new InvalidOperationException("NotificationPipeline:ServiceBusNamespace must be configured for --run-notification-worker.");
    }

    app.MapHealthChecks("/health");
    await app.RunAsync();
    return 0;
}

// The billing worker: with Google billing enabled its hosted service consumes the billing-events queue (and the queue namespace is
// required); disabled, it idles - deployable before billing is switched on, without crash-looping. The only endpoint is /health.
if (isBillingWorker)
{
    Juple.Api.Billing.BillingRuntimeActivation.EnsureWorkerConfiguration(billingOptions);

    app.MapHealthChecks("/health");
    await app.RunAsync();
    return 0;
}

// One-shot execution mode for the Blob cleanup retry Job (see AccountDeletionBlobCleanup/
// BlobCleanupService's own remarks). This is NOT a rare failure-only safety net: even a fully
// successful account deletion leaves its cleanup task pending on purpose - DeleteAccountService's
// immediate attempt only ever confirms the Blob prefix clean ONCE, which schedules a
// FinalSweepAfterUtc rather than removing the task, precisely because a request that had already
// passed its ownership check before deletion committed can still land a Blob afterward. Only a
// LATER run - this Job - can find the prefix clean a second time, at or after that grace period,
// and actually remove the task. So this Job is what every account deletion (failed-immediate-
// attempt or not) ultimately depends on to finish, not an optional extra. Intended for the same
// kind of scheduled Job invocation as the Push dispatch mode above, and deliberately never an HTTP
// endpoint for the same reason: nothing here ever reaches UseAuthentication/MapControllers/
// app.Run() below.
if (isBlobCleanupRetryJob)
{
    return await RunBlobCleanupRetryOnceAsync(app.Services);
}

// One-shot data-retention cleanup: removes what has outlived its retention period (see RetentionOptions) in bounded, repeatable batches.
if (isExpenseSyncJob)
{
    using var scope = app.Services.CreateScope();
    using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(20));
    await scope.ServiceProvider.GetRequiredService<Juple.Application.Expenses.ExpenseSyncService>().RunJobAsync(deadline.Token);
    if (scope.ServiceProvider.GetRequiredService<Juple.Application.Expenses.ExpenseOptions>().Enabled)
        await scope.ServiceProvider.GetRequiredService<Juple.Application.Expenses.ExpenseEvidenceService>().CleanupAsync(null, deadline.Token);
    return 0;
}
// Dedicated RG-scoped cost job. Never invokes recurring projection or evidence cleanup.
if (isAzureCostSyncJob)
{
    using var scope = app.Services.CreateScope();
    using var deadline = new CancellationTokenSource(TimeSpan.FromMinutes(20));
    using var termination = System.Runtime.InteropServices.PosixSignalRegistration.Create(
        System.Runtime.InteropServices.PosixSignal.SIGTERM, context => { context.Cancel = true; deadline.Cancel(); });
    var options = scope.ServiceProvider.GetRequiredService<Juple.Application.Expenses.ExpenseOptions>();
    if (!options.Enabled || !options.AzureSyncEnabled)
    {
        Console.WriteLine("AzureCostSync disabled; no queries or writes executed.");
        return 0;
    }
    const string allowedScope = "/subscriptions/37402353-9fc3-4fd7-bc9a-d5d2197b6b6b/resourceGroups/rg-juple-prod";
    if (options.AzureScopes.Count != 1 || options.AzureScopes[0].AllowWholeSubscription
        || !options.AzureScopes[0].Scope.Equals(allowedScope, StringComparison.OrdinalIgnoreCase))
    {
        Console.Error.WriteLine("AzureCostSync invalid approved scope; no queries or writes executed.");
        return 2;
    }
    var sync = scope.ServiceProvider.GetRequiredService<Juple.Application.Expenses.ExpenseSyncService>();
    var today = DateOnly.FromDateTime(TimeProvider.System.GetUtcNow().UtcDateTime);
    var current = new DateOnly(today.Year, today.Month, 1);
    try
    {
        foreach (var month in new[] { current.AddMonths(-1), current })
        {
            await sync.SyncAsync(null, allowedScope, month, deadline.Token);
            Console.WriteLine($"AzureCostSync succeeded month={month:yyyy-MM} scope=rg-juple-prod");
        }
        return 0;
    }
    catch (Exception error)
    {
        var code = error is Juple.Application.Expenses.ExpenseRequestException known ? known.Code
            : error is OperationCanceledException ? "cancelled" : "azureSyncFailed";
        Console.Error.WriteLine($"AzureCostSync failed code={code}; no exception details logged.");
        return 1;
    }
}
if (isRetentionCleanupJob)
{
    return await RunRetentionCleanupOnceAsync(app.Services);
}

// One-shot billing reconciliation (the Job that recovers lost wake-ups and re-checks due purchases against Google).
if (isBillingReconcileJob)
{
    return await Juple.Api.Billing.BillingRuntimeActivation.RunReconcileOnceAsync(app.Services);
}

// One-shot execution mode for the Instagram metadata retry Job (see
// InstagramMetadataRetryService/InstagramMetadataRetryTask's own remarks). Same rationale as the
// Blob cleanup retry Job above: the client's own synchronous best-effort metadata resolution
// (right after an Item is saved) is allowed to come back empty - confirmed to be genuinely
// transient, Instagram-side behavior - so this Job is what gives an affected Item up to two more
// backend-side tries on a schedule, never blocking the original save.
if (isInstagramMetadataRetryJob)
{
    return await RunInstagramMetadataRetryOnceAsync(app.Services);
}

// Billing:* (program switch, fixed 30-day trial, and - only once the program is enabled - ProgramStartAtUtc and the
// trial-ledger HMAC key): an invalid combination stops the API here with a message naming the setting.
Juple.Application.Billing.BillingOptionsValidator.Validate(billingOptions);
// Forces PublicCollectionCursor:EncryptionKey validation (see PublicCollectionItemPageCursorCodec's
// constructor) at startup rather than on the first public "load more" request.
app.Services.GetRequiredService<IPublicCollectionItemPageCursorCodec>();
// Same for CollectionUnlockGrant:EncryptionKey (see CollectionUnlockTokenProtector) - a missing or
// malformed grant key stops the API at startup; there is no fallback to any other key. The one-shot
// Job modes above return before this point and never need it.
app.Services.GetRequiredService<ICollectionUnlockTokenProtector>();
// Same for CollectionSharePassword:EncryptionKey (see CollectionSharePasswordProtector) - its own key,
// no fallback: without it the API does not start rather than failing the first reveal.
app.Services.GetRequiredService<ICollectionSharePasswordProtector>();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Outermost, so authentication and CORS time is part of the measured request. Only when RequestTiming:Enabled (Dev diagnostics).
var requestTimingEnabled = builder.Configuration.GetValue<bool>($"{RequestTimingOptions.SectionName}:Enabled");
if (requestTimingEnabled)
{
    app.UseMiddleware<RequestTimingMiddleware>();
}

app.UseHttpsRedirection();
app.UseCors();
// Two clock reads around authentication (RequestTimingMarks) - they never run it and change nothing about it.
if (requestTimingEnabled)
{
    app.Use(RequestTimingMarks.BeforeAuthentication);
}

app.UseAuthentication();
if (requestTimingEnabled)
{
    app.Use(RequestTimingMarks.AfterAuthentication);
}

// Admission happens after validated JWT authentication but BEFORE active-admin SQL authorization,
// activity tracking and MVC filters/model binding. Rejected requests do not enter those services.
// Only upload endpoints opt into a timeout; streaming exports retain their existing own budget.
// This also cancels a queued upload or slow multipart body, releasing its admission lease.
app.UseRequestTimeouts();
app.UseRateLimiter();
app.UseMiddleware<Juple.Api.Analytics.UserActivityMiddleware>();
app.UseAuthorization();
app.MapControllers();
// /health: liveness - the process answers (unchanged meaning; the warm-up check is excluded). /health/ready: the warm-up is done.
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = check => !check.Tags.Contains("ready") });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = check => check.Tags.Contains("ready") });

app.Run();
return 0;

static async Task<int> RunPushDispatchOnceAsync(IServiceProvider rootServices)
{
    await using var scope = rootServices.CreateAsyncScope();
    var dispatchService = scope.ServiceProvider.GetRequiredService<IDispatchPendingPushNotificationsService>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("PushDispatchJob");

    try
    {
        var result = await dispatchService.RunOnceAsync();
        var stats = await scope.ServiceProvider.GetRequiredService<INotificationEventStore>().GetStatsAsync(TimeProvider.System.GetUtcNow());
        if (result.Pending != 0 || result.Sent != 0 || result.Failed != 0 || result.Skipped != 0 || result.Expired != 0
            || result.EventsRecovered != 0 || stats.PendingEvents != 0 || stats.PendingNotifications != 0
            || result.EventRetriesScheduled != 0 || stats.EventsRequiringAttention != 0 || stats.EventsFailedPermanently != 0)
        {
            logger.LogInformation(
                "Push dispatch complete. Pending={Pending} Sent={Sent} Failed={Failed} Skipped={Skipped} Expired={Expired} EventsRecovered={EventsRecovered} OutboxPending={OutboxPending} OutboxOldestSeconds={OutboxOldestSeconds} NotificationsPending={NotificationsPending} NotificationsOldestSeconds={NotificationsOldestSeconds} EventRetriesScheduled={EventRetriesScheduled} EventsRequiringAttention={EventsRequiringAttention} EventsFailedPermanently={EventsFailedPermanently}",
                result.Pending, result.Sent, result.Failed, result.Skipped, result.Expired, result.EventsRecovered,
                stats.PendingEvents, stats.OldestPendingEventSeconds, stats.PendingNotifications, stats.OldestPendingNotificationSeconds,
                result.EventRetriesScheduled, stats.EventsRequiringAttention, stats.EventsFailedPermanently);
        }
        return 0;
    }
    catch (Exception exception)
    {
        // A scheduled Job's exit code is how Azure reports failure.
        logger.LogError(exception, "Push dispatch run failed.");
        return 1;
    }
}

static async Task<int> RunBlobCleanupRetryOnceAsync(IServiceProvider rootServices)
{
    await using var scope = rootServices.CreateAsyncScope();
    var blobCleanupService = scope.ServiceProvider.GetRequiredService<IBlobCleanupService>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("BlobCleanupRetryJob");

    try
    {
        var result = await blobCleanupService.RunPendingCleanupsAsync();
        if (result.Pending != 0 || result.Succeeded != 0 || result.Deferred != 0 || result.Failed != 0)
        {
            logger.LogInformation(
                "Blob cleanup retry complete. Pending={Pending} Succeeded={Succeeded} Deferred={Deferred} Failed={Failed}",
                result.Pending, result.Succeeded, result.Deferred, result.Failed);
        }

        // The same scheduled pass also finishes any Entra sign-in account deletion that did not succeed right away (idempotent).
        var entraResult = await scope.ServiceProvider.GetRequiredService<Juple.Application.Users.DeleteAccount.IEntraIdentityDeletionService>().RunPendingAsync();
        if (entraResult.Skipped)
        {
            // EntraAccountDeletion:Enabled is false: not a failure - any pending rows wait until the feature is enabled again.
            var disabledStats = await scope.ServiceProvider.GetRequiredService<Juple.Application.Users.DeleteAccount.IEntraIdentityDeletionStore>()
                .GetStatsAsync(TimeProvider.System.GetUtcNow());
            if (disabledStats.PendingCount > 0)
            {
                logger.LogWarning(
                    "account.entra-deletion.pending PendingCount={PendingCount} OldestPendingSeconds={OldestPendingSeconds} FailedPendingCount={FailedPendingCount} RepeatedFailureCount={RepeatedFailureCount} RetryEnabled=false",
                    disabledStats.PendingCount, disabledStats.OldestPendingSeconds, disabledStats.FailedPendingCount, disabledStats.RepeatedFailureCount);
            }
            return 0;
        }

        var entraStats = await scope.ServiceProvider.GetRequiredService<Juple.Application.Users.DeleteAccount.IEntraIdentityDeletionStore>()
            .GetStatsAsync(TimeProvider.System.GetUtcNow());
        if (entraResult.Pending != 0 || entraStats.PendingCount != 0)
        {
            logger.LogInformation(
                "account.entra-deletion.retry Processed={Processed} Succeeded={Succeeded} Failed={Failed} PendingCount={PendingCount} OldestPendingSeconds={OldestPendingSeconds} FailedPendingCount={FailedPendingCount} RepeatedFailureCount={RepeatedFailureCount}",
                entraResult.Pending, entraResult.Succeeded, entraResult.Failed, entraStats.PendingCount,
                entraStats.OldestPendingSeconds, entraStats.FailedPendingCount, entraStats.RepeatedFailureCount);
        }
        return entraResult.Failed == 0 ? 0 : 1;
    }
    catch (Exception exception)
    {
        // Same rationale as RunPushDispatchOnceAsync's own catch block - a scheduled Job's exit
        // code is how Azure reports failure.
        logger.LogError(exception, "Blob cleanup retry run failed.");
        return 1;
    }
}

static async Task<int> RunRetentionCleanupOnceAsync(IServiceProvider rootServices)
{
    await using var scope = rootServices.CreateAsyncScope();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("RetentionCleanupJob");

    try
    {
        // An invalid period (zero or negative would purge live data) stops the run before anything is touched.
        Juple.Application.Retention.RetentionOptionsValidator.Validate(scope.ServiceProvider.GetRequiredService<Juple.Application.Retention.RetentionOptions>());
        var result = await scope.ServiceProvider.GetRequiredService<Juple.Application.Retention.IRetentionCleanupService>().RunAsync();
        foreach (var category in result.Categories)
        {
            logger.LogInformation(
                "retention.purged Category={Category} Purged={Purged} Batches={Batches} HitBatchLimit={HitBatchLimit} Error={Error}",
                category.Category, category.Purged, category.Batches, category.HitBatchLimit, category.ErrorType ?? "none");
        }

        logger.LogInformation("Retention cleanup complete. TotalPurged={TotalPurged} Failures={Failures}", result.TotalPurged, result.Categories.Count(category => category.ErrorType is not null));
        // Everything that could run did; a failed category is reported through the exit code so the scheduler shows it, and the next run continues.
        return result.HasFailures ? 1 : 0;
    }
    catch (Exception exception)
    {
        logger.LogError(exception, "Retention cleanup run failed.");
        return 1;
    }
}

static async Task<int> RunInstagramMetadataRetryOnceAsync(IServiceProvider rootServices)
{
    await using var scope = rootServices.CreateAsyncScope();
    var retryService = scope.ServiceProvider.GetRequiredService<IInstagramMetadataRetryService>();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>()
        .CreateLogger("InstagramMetadataRetryJob");

    try
    {
        var result = await retryService.RunOnceAsync();
        if (result.DueTaskCount != 0)
        {
            logger.LogInformation(
                "Instagram metadata retry run complete. Due={Due} Resolved={Resolved} " +
                "Rescheduled={Rescheduled} GaveUp={GaveUp} AlreadySatisfied={AlreadySatisfied} " +
                "SkippedNotClaimed={SkippedNotClaimed}",
                result.DueTaskCount, result.Resolved, result.Rescheduled, result.GaveUp,
                result.AlreadySatisfied, result.SkippedNotClaimed);
        }
        return 0;
    }
    catch (Exception exception)
    {
        // Same rationale as RunBlobCleanupRetryOnceAsync's own catch block - a scheduled Job's exit
        // code is how Azure reports failure.
        logger.LogError(exception, "Instagram metadata retry run failed.");
        return 1;
    }
}
