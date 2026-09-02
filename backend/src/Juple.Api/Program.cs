using Juple.Infrastructure;
using Juple.Api.Authentication;
using Juple.Application.Categories.CreateCategory;
using Juple.Application.Categories.DeleteCategory;
using Juple.Application.Categories.ListCategories;
using Juple.Application.Categories.RenameCategory;
using Juple.Application.Identity;
using Juple.Application.Images.DeleteItemImage;
using Juple.Application.Images.ListItemImages;
using Juple.Application.Images.UploadItemImage;
using Juple.Application.Inbox.GetDailyInbox;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.Items.AssignItemCategory;
using Juple.Application.Items.DeleteItem;
using Juple.Application.Items.GetItemDetail;
using Juple.Application.Items.GetItemsByState;
using Juple.Application.Items.ItemStateTransition;
using Juple.Application.Items.UpdateItemDetails;
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
builder.Services.AddScoped<IDeleteItemService, DeleteItemService>();
builder.Services.AddScoped<IUpdateItemDetailsService, UpdateItemDetailsService>();
builder.Services.AddScoped<IGetItemDetailService, GetItemDetailService>();
builder.Services.AddScoped<IAssignItemCategoryService, AssignItemCategoryService>();
builder.Services.AddScoped<IListCategoriesService, ListCategoriesService>();
builder.Services.AddScoped<ICreateCategoryService, CreateCategoryService>();
builder.Services.AddScoped<IRenameCategoryService, RenameCategoryService>();
builder.Services.AddScoped<IDeleteCategoryService, DeleteCategoryService>();
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
