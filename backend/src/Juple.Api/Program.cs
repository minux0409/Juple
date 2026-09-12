using Juple.Infrastructure;
using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Public;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.CreateCollection;
using Juple.Application.Collections.DeleteCollection;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.GetCollectionDetail;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.GetCollectionShare;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Collections.RenameCollection;
using Juple.Application.Collections.RevokeCollectionShare;
using Juple.Application.Collections.SetCollectionFavorite;
using Juple.Application.Identity;
using Juple.Application.Images.BlobCleanup;
using Juple.Application.Images.DeleteItemImage;
using Juple.Application.Images.ListItemImages;
using Juple.Application.Images.UploadItemImage;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.Items.DeleteAllRecentlyOpenedLinks;
using Juple.Application.Items.DeleteItem;
using Juple.Application.Items.DeleteRecentlyOpenedLink;
using Juple.Application.Items.GetItemDetail;
using Juple.Application.Items.GetItemHistory;
using Juple.Application.Items.GetItemHistoryByDate;
using Juple.Application.Items.GetRecentlyOpenedLinks;
using Juple.Application.Items.RecordItemOpen;
using Juple.Application.Items.UpdateItemDetails;
using Juple.Application.Push.RegisterPushDevice;
using Juple.Application.Push.UnregisterPushDevice;
using Juple.Application.UrlMetadata.ResolveUrlMetadata;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Application.Users.DeleteAccount;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

// Decided this early (before any config validation below) because this one-shot execution mode has
// genuinely different configuration requirements from the HTTP API: it does not authenticate a
// request - it runs entirely outside UseAuthentication/UseAuthorization/MapControllers (see the
// early-return branch further down) - so it has no legitimate need for Entra config at all. Only
// the actual HTTP API path keeps the existing fail-fast below unchanged.
//
// --run-push-dispatch is still recognized (see the no-op branch below) but no longer does anything
// real - RepeatPurchase/Notification, the only feature it ever dispatched, was removed as a legacy
// Purchase feature (Juple is a URL Library app; see docs/architecture.md). Kept recognized, rather
// than removed outright, so the existing scheduled Azure Container Apps Job
// (caj-juple-push-dispatch-dev - see infra/azure/README.md) exits cleanly and immediately instead
// of falling through to full HTTP API startup (binding a port, running inside a batch Job context)
// the next time it fires - see infra/azure/README.md for the follow-up decision on removing that
// Job's IaC once this is confirmed to no longer be needed.
var isPushDispatchJob = args.Contains("--run-push-dispatch", StringComparer.Ordinal);
var isBlobCleanupRetryJob = args.Contains("--run-blob-cleanup-retry", StringComparer.Ordinal);
var isOneShotJob = isPushDispatchJob || isBlobCleanupRetryJob;

// Never required, and never validated, for either Job - RequireScope still needs a non-null value
// to register the policy below, but that policy is only ever evaluated by the ASP.NET Core
// request pipeline neither Job runs.
var requiredScope = isOneShotJob
    ? string.Empty
    : builder.Configuration["Authentication:EntraExternalId:RequiredScope"]
        ?? throw new InvalidOperationException("Authentication:EntraExternalId:RequiredScope must be configured.");

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IExternalIdentityAccessor, HttpContextExternalIdentityAccessor>();
builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
builder.Services.AddScoped<ICurrentUserBootstrapService, CurrentUserBootstrapService>();
builder.Services.AddScoped<IDeleteAccountService, DeleteAccountService>();
builder.Services.AddScoped<IInboxEntrySaveService, InboxEntrySaveService>();
builder.Services.AddScoped<IGetItemHistoryService, GetItemHistoryService>();
builder.Services.AddScoped<IGetItemHistoryByDateService, GetItemHistoryByDateService>();
builder.Services.AddScoped<IRecordItemOpenService, RecordItemOpenService>();
builder.Services.AddScoped<IGetRecentlyOpenedLinksService, GetRecentlyOpenedLinksService>();
builder.Services.AddScoped<IDeleteRecentlyOpenedLinkService, DeleteRecentlyOpenedLinkService>();
builder.Services.AddScoped<IDeleteAllRecentlyOpenedLinksService, DeleteAllRecentlyOpenedLinksService>();
builder.Services.AddScoped<IDeleteItemService, DeleteItemService>();
builder.Services.AddScoped<IUpdateItemDetailsService, UpdateItemDetailsService>();
builder.Services.AddScoped<IGetItemDetailService, GetItemDetailService>();
builder.Services.AddScoped<IListCollectionsService, ListCollectionsService>();
builder.Services.AddScoped<ICreateCollectionService, CreateCollectionService>();
builder.Services.AddScoped<IGetCollectionDetailService, GetCollectionDetailService>();
builder.Services.AddScoped<IRenameCollectionService, RenameCollectionService>();
builder.Services.AddScoped<ISetCollectionFavoriteService, SetCollectionFavoriteService>();
builder.Services.AddScoped<IDeleteCollectionService, DeleteCollectionService>();
builder.Services.AddScoped<IGetCollectionItemsService, GetCollectionItemsService>();
builder.Services.AddScoped<IAddItemToCollectionService, AddItemToCollectionService>();
builder.Services.AddScoped<IRemoveItemFromCollectionService, RemoveItemFromCollectionService>();
builder.Services.AddScoped<IEnableCollectionShareService, EnableCollectionShareService>();
builder.Services.AddScoped<IGetCollectionShareService, GetCollectionShareService>();
builder.Services.AddScoped<IRevokeCollectionShareService, RevokeCollectionShareService>();
builder.Services.AddScoped<IPublicCollectionService, PublicCollectionService>();
builder.Services.Configure<PublicWebOptions>(builder.Configuration.GetSection("PublicWeb"));
builder.Services.Configure<PublicCollectionCursorOptions>(
    builder.Configuration.GetSection("PublicCollectionCursor"));
builder.Services.AddSingleton<IPublicCollectionItemPageCursorCodec, PublicCollectionItemPageCursorCodec>();
builder.Services.AddScoped<IRegisterPushDeviceService, RegisterPushDeviceService>();
builder.Services.AddScoped<IUnregisterPushDeviceService, UnregisterPushDeviceService>();
builder.Services.AddScoped<IListItemImagesService, ListItemImagesService>();
builder.Services.AddScoped<IUploadItemImageService, UploadItemImageService>();
builder.Services.AddScoped<IDeleteItemImageService, DeleteItemImageService>();
builder.Services.AddScoped<IResolveUrlMetadataService, ResolveUrlMetadataService>();
builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(
        builder.Configuration.GetSection("Authentication:EntraExternalId"));
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

// Deliberate no-op - see the isPushDispatchJob comment above for why this is kept recognized
// rather than removed. Exits immediately, before UseAuthentication/MapControllers/app.Run() below,
// so the still-scheduled Azure Container Apps Job invocation exits cleanly rather than falling
// through to full HTTP API startup.
if (isPushDispatchJob)
{
    Console.WriteLine(
        "Push dispatch is no longer implemented - RepeatPurchase/Notification was removed as a " +
        "legacy Purchase feature (see docs/architecture.md). This Job invocation is a deliberate " +
        "no-op.");
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

// Forces PublicCollectionCursor:EncryptionKey validation (see PublicCollectionItemPageCursorCodec's
// constructor) at startup rather than on the first public "load more" request.
app.Services.GetRequiredService<IPublicCollectionItemPageCursorCodec>();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHealthChecks("/health");

app.Run();
return 0;

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
