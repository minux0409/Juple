using Juple.Infrastructure;
using Juple.Api.Authentication;
using Juple.Application.Categories.CreateCategory;
using Juple.Application.Categories.DeleteCategory;
using Juple.Application.Categories.ListCategories;
using Juple.Application.Categories.RenameCategory;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.CreateCollection;
using Juple.Application.Collections.DeleteCollection;
using Juple.Application.Collections.GetCollectionDetail;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Collections.RenameCollection;
using Juple.Application.Collections.SetCollectionFavorite;
using Juple.Application.Identity;
using Juple.Application.Images.DeleteItemImage;
using Juple.Application.Images.ListItemImages;
using Juple.Application.Images.UploadItemImage;
using Juple.Application.Inbox.GetDailyInbox;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.Items.AssignItemCategory;
using Juple.Application.Items.DeleteItem;
using Juple.Application.Items.GetItemDetail;
using Juple.Application.Items.GetItemHistory;
using Juple.Application.Items.GetItemHistoryByDate;
using Juple.Application.Items.GetItemsByState;
using Juple.Application.Items.ItemStateTransition;
using Juple.Application.Items.UpdateItemDetails;
using Juple.Application.Purchases.CreatePurchase;
using Juple.Application.Purchases.DeletePurchase;
using Juple.Application.Purchases.GetPurchaseDetail;
using Juple.Application.Purchases.ListPurchases;
using Juple.Application.Purchases.UpdatePurchase;
using Juple.Application.RepeatPurchases.CreateRepeatPurchase;
using Juple.Application.RepeatPurchases.DeleteRepeatPurchase;
using Juple.Application.RepeatPurchases.GetRepeatPurchaseDetail;
using Juple.Application.RepeatPurchases.ListRepeatPurchases;
using Juple.Application.RepeatPurchases.LogPurchase;
using Juple.Application.RepeatPurchases.RepeatPurchaseStateTransition;
using Juple.Application.RepeatPurchases.UpdateRepeatPurchase;
using Juple.Application.Users.BootstrapCurrentUser;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

var requiredScope = builder.Configuration["Authentication:EntraExternalId:RequiredScope"]
    ?? throw new InvalidOperationException("Authentication:EntraExternalId:RequiredScope must be configured.");

builder.Services.AddInfrastructure(builder.Configuration);
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<IExternalIdentityAccessor, HttpContextExternalIdentityAccessor>();
builder.Services.AddSingleton<TimeProvider>(TimeProvider.System);
builder.Services.AddScoped<ICurrentUserBootstrapService, CurrentUserBootstrapService>();
builder.Services.AddScoped<IInboxEntrySaveService, InboxEntrySaveService>();
builder.Services.AddScoped<IGetDailyInboxService, GetDailyInboxService>();
builder.Services.AddScoped<IItemStateTransitionService, ItemStateTransitionService>();
builder.Services.AddScoped<IGetItemsByStateService, GetItemsByStateService>();
builder.Services.AddScoped<IGetItemHistoryService, GetItemHistoryService>();
builder.Services.AddScoped<IGetItemHistoryByDateService, GetItemHistoryByDateService>();
builder.Services.AddScoped<IDeleteItemService, DeleteItemService>();
builder.Services.AddScoped<IUpdateItemDetailsService, UpdateItemDetailsService>();
builder.Services.AddScoped<IGetItemDetailService, GetItemDetailService>();
builder.Services.AddScoped<IAssignItemCategoryService, AssignItemCategoryService>();
builder.Services.AddScoped<IListCategoriesService, ListCategoriesService>();
builder.Services.AddScoped<ICreateCategoryService, CreateCategoryService>();
builder.Services.AddScoped<IRenameCategoryService, RenameCategoryService>();
builder.Services.AddScoped<IDeleteCategoryService, DeleteCategoryService>();
builder.Services.AddScoped<IListCollectionsService, ListCollectionsService>();
builder.Services.AddScoped<ICreateCollectionService, CreateCollectionService>();
builder.Services.AddScoped<IGetCollectionDetailService, GetCollectionDetailService>();
builder.Services.AddScoped<IRenameCollectionService, RenameCollectionService>();
builder.Services.AddScoped<ISetCollectionFavoriteService, SetCollectionFavoriteService>();
builder.Services.AddScoped<IDeleteCollectionService, DeleteCollectionService>();
builder.Services.AddScoped<IGetCollectionItemsService, GetCollectionItemsService>();
builder.Services.AddScoped<IAddItemToCollectionService, AddItemToCollectionService>();
builder.Services.AddScoped<IRemoveItemFromCollectionService, RemoveItemFromCollectionService>();
builder.Services.AddScoped<IListPurchasesService, ListPurchasesService>();
builder.Services.AddScoped<IGetPurchaseDetailService, GetPurchaseDetailService>();
builder.Services.AddScoped<ICreatePurchaseService, CreatePurchaseService>();
builder.Services.AddScoped<IUpdatePurchaseService, UpdatePurchaseService>();
builder.Services.AddScoped<IDeletePurchaseService, DeletePurchaseService>();
builder.Services.AddScoped<IListRepeatPurchasesService, ListRepeatPurchasesService>();
builder.Services.AddScoped<IGetRepeatPurchaseDetailService, GetRepeatPurchaseDetailService>();
builder.Services.AddScoped<ICreateRepeatPurchaseService, CreateRepeatPurchaseService>();
builder.Services.AddScoped<IUpdateRepeatPurchaseService, UpdateRepeatPurchaseService>();
builder.Services.AddScoped<IRepeatPurchaseStateTransitionService, RepeatPurchaseStateTransitionService>();
builder.Services.AddScoped<IDeleteRepeatPurchaseService, DeleteRepeatPurchaseService>();
builder.Services.AddScoped<ILogPurchaseService, LogPurchaseService>();
builder.Services.AddScoped<IListItemImagesService, ListItemImagesService>();
builder.Services.AddScoped<IUploadItemImageService, UploadItemImageService>();
builder.Services.AddScoped<IDeleteItemImageService, DeleteItemImageService>();
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

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHealthChecks("/health");

app.Run();
