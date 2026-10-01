using System.Text.Json;
using Juple.Api.Controllers;

namespace Juple.UnitTests.Collections;

/// <summary>
/// The body the app sends when the Owner confirms "권한도 함께 변경" must reach the controller as a
/// real flag - a field the model binder silently dropped would make the raise a no-op that still
/// answers 409 publicSharePermissionMismatch. ASP.NET Core reads request bodies with the web defaults.
/// </summary>
public sealed class SharePermissionRequestBindingTests
{
    private static CollectionsController.SetSharePermissionRequest? Bind(string json) =>
        JsonSerializer.Deserialize<CollectionsController.SetSharePermissionRequest>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    [Theory]
    [InlineData("""{"permission":"write","raiseLowerRoles":true}""", "write", true)]
    [InlineData("""{"permission":"submit","raiseLowerRoles":true}""", "submit", true)]
    [InlineData("""{"permission":"submit","raiseLowerRoles":false}""", "submit", false)]
    public void TheConfirmedRaiseArrivesAsTheFlag(string json, string permission, bool raise)
    {
        var request = Bind(json)!;

        Assert.Equal(permission, request.Permission);
        Assert.Equal(raise, request.RaiseLowerRoles);
    }

    [Theory]
    [InlineData("""{"permission":"write"}""")]
    [InlineData("""{"permission":"write","raiseLowerRoles":null}""")]
    public void WithoutTheFlagItIsOff_SoOlderAppsKeepTheirBehavior(string json)
    {
        var request = Bind(json)!;

        Assert.NotEqual(true, request.RaiseLowerRoles);
    }
}
