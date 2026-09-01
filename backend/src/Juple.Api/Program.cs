using Juple.Infrastructure;
using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Inbox.GetDailyInbox;
using Juple.Application.Inbox.SaveInboxEntry;
using Juple.Application.Items.ItemStateTransition;
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
