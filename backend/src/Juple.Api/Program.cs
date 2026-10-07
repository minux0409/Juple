using Juple.Infrastructure;
using Juple.Api.Authentication;
using Juple.Api.Configuration;
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
var isOneShotJob = isPushDispatchJob || isBlobCleanupRetryJob || isInstagramMetadataRetryJob || isBillingReconcileJob;
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

if (isBillingWorker)
{
    builder.Services.AddHostedService<Juple.Api.Billing.BillingWorkerService>();
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
builder.Services.AddScoped<Juple.Application.Billing.ITrialIdentityHasher, Juple.Application.Billing.TrialIdentityHasher>();
builder.Services.AddScoped<Juple.Application.Billing.IEntitlementService, Juple.Application.Billing.EntitlementService>();
builder.Services.AddSingleton<Juple.Application.Billing.IPurchaseTokenProtector, Juple.Application.Billing.PurchaseTokenProtector>();
builder.Services.AddSingleton<Juple.Application.Billing.GooglePlay.IGoogleAccountIdProvider, Juple.Application.Billing.GooglePlay.GoogleAccountIdProvider>();
builder.Services.AddScoped<Juple.Application.Billing.GooglePlay.IGoogleBillingService, Juple.Application.Billing.GooglePlay.GoogleBillingService>();
builder.Services.AddScoped<Juple.Application.Billing.GooglePlay.IGoogleBillingProcessor, Juple.Application.Billing.GooglePlay.GoogleBillingProcessor>();
builder.Services.AddScoped<ICurrentUserBootstrapService, CurrentUserBootstrapService>();
builder.Services.AddScoped<IDeleteAccountService, DeleteAccountService>();
builder.Services.AddScoped<IInboxEntrySaveService, InboxEntrySaveService>();
builder.Services.AddScoped<Juple.Application.Support.ISupportInquiryService, Juple.Application.Support.SupportInquiryService>();
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
builder.Services.AddScoped<IUserProfileService, UserProfileService>();
builder.Services.AddScoped<Juple.Application.Friends.IFriendService, Juple.Application.Friends.FriendService>();
builder.Services.AddSingleton<ICollectionLockPasswordHasher, CollectionLockPasswordHasher>();
builder.Services.AddSingleton<ICollectionUnlockTokenProtector, CollectionUnlockTokenProtector>();
builder.Services.AddSingleton<ICollectionSharePasswordProtector, CollectionSharePasswordProtector>();
builder.Services.AddScoped<ICollectionSharePasswordService, CollectionSharePasswordService>();
builder.Services.Configure<PublicWebOptions>(builder.Configuration.GetSection("PublicWeb"));
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

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(AuthorizationPolicies.JupleUser, policy =>
    {
        policy.RequireAuthenticatedUser();
        policy.RequireScope(requiredScope);
        policy.RequireAssertion(context =>
            Guid.TryParse(context.User.GetTenantId(), out _)
            && Guid.TryParse(context.User.GetObjectId(), out _));
    });

builder.Services.AddControllers();
builder.Services.AddProblemDetails();

// First rate limiting in this API (built into ASP.NET Core - no package). These in-process
// limiters are a per-replica first line only; the brute-force guarantee for lock passwords is the
// persisted, cross-replica CollectionUnlockThrottle, and Juple ID enumeration is additionally
// bounded by the 31^8 code space. Partitioned per signed-in identity (tenant+object id) for the
// authenticated endpoints, per share link for the anonymous public unlock.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy(RateLimitPolicies.JupleIdLookup, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPolicies.IdentityPartitionKey(httpContext),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));
    options.AddPolicy(RateLimitPolicies.BillingGoogle, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPolicies.IdentityPartitionKey(httpContext),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
    options.AddPolicy(RateLimitPolicies.CollectionUnlock, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPolicies.IdentityPartitionKey(httpContext),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    // Per link AND per browser attempt id - never per link alone, which would let one client
    // exhaust the permits for everyone. The persisted link-wide ceiling lives in
    // CollectionUnlockBuckets (DB, cross-replica), not here.
    // Adding links through a writable public link: signed-in callers only, per identity - bounds
    // how fast one account can fill someone else's public Collection.
    options.AddPolicy(RateLimitPolicies.PublicCollectionWrite, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPolicies.IdentityPartitionKey(httpContext),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));
    // Sending Collection invitations: its own bucket (not the Juple ID lookup one), so inviting a
    // larger group - friends need no lookup - is not capped by lookups. Still bounded per identity:
    // an invitation is visible to its recipient, so this also limits invitation spam.
    options.AddPolicy(RateLimitPolicies.CollectionInvite, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPolicies.IdentityPartitionKey(httpContext),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 30, Window = TimeSpan.FromMinutes(10), QueueLimit = 0 }));
    // Changing/resetting the one Collection lock password: 5 per 15 minutes per identity, on top of
    // the persisted wrong-current-password throttle and the recent sign-in a reset requires.
    options.AddPolicy(RateLimitPolicies.CollectionLockPassword, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPolicies.IdentityPartitionKey(httpContext),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 5, Window = TimeSpan.FromMinutes(15), QueueLimit = 0 }));
    // Sending a support inquiry: per identity, so one account cannot fill the support queue.
    options.AddPolicy(RateLimitPolicies.SupportInquiryCreate, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPolicies.IdentityPartitionKey(httpContext),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromHours(1), QueueLimit = 0 }));
    options.AddPolicy(RateLimitPolicies.PublicCollectionUnlock, httpContext =>
        RateLimitPartition.GetFixedWindowLimiter(
            RateLimitPolicies.PublicUnlockPartitionKey(httpContext),
            _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});
builder.Services.AddHealthChecks();
builder.Services.AddOpenApi();

// Scoped to PublicCollectionsController alone (see its [EnableCors] attribute) - the
// authenticated Mobile-facing API surface has no default CORS policy and is unaffected. Left with
// no allowed origins (WithOrigins requires at least one non-empty value) until PublicWeb:BaseUrl
// is actually configured, so an unconfigured environment allows no cross-origin browser calls
// rather than silently allowing everything.
var publicWebBaseUrl = builder.Configuration["PublicWeb:BaseUrl"];
builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicies.PublicWeb, policy =>
    {
        if (!string.IsNullOrWhiteSpace(publicWebBaseUrl))
        {
            policy.WithOrigins(publicWebBaseUrl).WithMethods("GET").AllowAnyHeader();
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

// The billing worker: its hosted service consumes the billing-events queue; the only endpoint is /health. Google billing and a queue
// namespace are required - without them there is nothing to do, a misconfiguration.
if (isBillingWorker)
{
    if (!billingOptions.Google.Enabled || string.IsNullOrWhiteSpace(billingOptions.Events.ServiceBusNamespace))
    {
        throw new InvalidOperationException("Billing:Google:Enabled and Billing:Events:ServiceBusNamespace must be configured for --run-billing-worker.");
    }

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

// One-shot billing reconciliation (the Job that recovers lost wake-ups and re-checks due purchases against Google).
if (isBillingReconcileJob)
{
    return await RunBillingReconcileOnceAsync(app.Services);
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

app.UseHttpsRedirection();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapControllers();
app.MapHealthChecks("/health");

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
        logger.LogInformation(
            "Push dispatch complete. Pending={Pending} Sent={Sent} Failed={Failed} Skipped={Skipped} Expired={Expired} EventsRecovered={EventsRecovered} OutboxPending={OutboxPending} OutboxOldestSeconds={OutboxOldestSeconds} NotificationsPending={NotificationsPending} NotificationsOldestSeconds={NotificationsOldestSeconds} EventRetriesScheduled={EventRetriesScheduled} EventsRequiringAttention={EventsRequiringAttention} EventsFailedPermanently={EventsFailedPermanently}",
            result.Pending, result.Sent, result.Failed, result.Skipped, result.Expired, result.EventsRecovered,
            stats.PendingEvents, stats.OldestPendingEventSeconds, stats.PendingNotifications, stats.OldestPendingNotificationSeconds,
            result.EventRetriesScheduled, stats.EventsRequiringAttention, stats.EventsFailedPermanently);
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
        logger.LogInformation(
            "Blob cleanup retry complete. Pending={Pending} Succeeded={Succeeded} Deferred={Deferred} Failed={Failed}",
            result.Pending, result.Succeeded, result.Deferred, result.Failed);
        return 0;
    }
    catch (Exception exception)
    {
        // Same rationale as RunPushDispatchOnceAsync's own catch block - a scheduled Job's exit
        // code is how Azure reports failure.
        logger.LogError(exception, "Blob cleanup retry run failed.");
        return 1;
    }
}

static async Task<int> RunBillingReconcileOnceAsync(IServiceProvider rootServices)
{
    await using var scope = rootServices.CreateAsyncScope();
    var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("BillingReconcileJob");
    var billing = scope.ServiceProvider.GetRequiredService<Juple.Application.Billing.BillingOptions>();
    if (!billing.Google.Enabled)
    {
        logger.LogInformation("Google billing is not enabled; nothing to reconcile.");
        return 0;
    }

    try
    {
        // Bounded on purpose: the cadence per purchase is set by the purchase itself (see GooglePurchaseNormalizer), never a hot loop.
        var summary = await scope.ServiceProvider.GetRequiredService<Juple.Application.Billing.GooglePlay.IGoogleBillingProcessor>().SweepAsync(eventLimit: 100, purchaseLimit: 100);
        logger.LogInformation(
            "Billing reconcile complete. EventsProcessed={EventsProcessed} PurchasesReconciled={PurchasesReconciled} Failures={Failures}",
            summary.EventsProcessed, summary.PurchasesReconciled, summary.Failures);
        return 0;
    }
    catch (Exception exception)
    {
        logger.LogError("Billing reconcile run failed ({ErrorType}).", exception.GetType().Name);
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
        logger.LogInformation(
            "Instagram metadata retry run complete. Due={Due} Resolved={Resolved} " +
            "Rescheduled={Rescheduled} GaveUp={GaveUp} AlreadySatisfied={AlreadySatisfied} " +
            "SkippedNotClaimed={SkippedNotClaimed}",
            result.DueTaskCount, result.Resolved, result.Rescheduled, result.GaveUp,
            result.AlreadySatisfied, result.SkippedNotClaimed);
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
