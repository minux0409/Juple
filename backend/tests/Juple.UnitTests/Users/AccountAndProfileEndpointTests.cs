using System.Security.Claims;
using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Controllers;
using Juple.Application.Identity;
using Juple.Application.Images;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.DeleteAccount;
using Juple.Application.Users.Profile;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Juple.UnitTests.Users;

public sealed class AccountAndProfileEndpointTests
{
    private const long UserId = 7;

    // ---------- account deletion: recent sign-in ----------

    [Fact]
    public async Task DeleteAccount_WithAFreshSignIn_DeletesTheCallersOwnAccount()
    {
        var service = new RecordingDeleteAccountService();
        var controller = WithClaims(
            new AccountController(new FixedIdentity(), new FixedUser(UserId), service),
            new Claim("auth_time", DateTimeOffset.UtcNow.AddSeconds(-20).ToUnixTimeSeconds().ToString()));

        Assert.IsType<NoContentResult>(await controller.DeleteAsync(CancellationToken.None));
        Assert.Equal(UserId, service.DeletedUserId);
    }

    [Fact]
    public async Task DeleteAccount_WithoutARecentSignIn_Is403RecentAuthenticationRequired_AndDeletesNothing()
    {
        foreach (var claims in new[]
        {
            Array.Empty<Claim>(),
            [new Claim("auth_time", DateTimeOffset.UtcNow.AddMinutes(-6).ToUnixTimeSeconds().ToString())],
            // A refreshed token has a fresh iat without a new sign-in - never accepted as evidence.
            [new Claim("iat", DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString())],
        })
        {
            var service = new RecordingDeleteAccountService();
            var controller = WithClaims(new AccountController(new FixedIdentity(), new FixedUser(UserId), service), claims);

            var problem = Assert.IsType<ObjectResult>(await controller.DeleteAsync(CancellationToken.None));
            Assert.Equal(403, problem.StatusCode);
            Assert.Equal(CollectionProblems.RecentAuthenticationRequiredCode, ((ProblemDetails)problem.Value!).Extensions["code"]);
            Assert.Null(service.DeletedUserId);
        }
    }

    [Fact]
    public async Task DeleteAccount_ForAnAlreadyDeletedAccount_KeepsItsExisting409()
    {
        var service = new RecordingDeleteAccountService();
        var controller = WithClaims(new AccountController(new FixedIdentity(), new MissingUser(), service));

        var problem = Assert.IsType<ObjectResult>(await controller.DeleteAsync(CancellationToken.None));
        Assert.Equal(409, problem.StatusCode);
        Assert.Null(service.DeletedUserId);
    }

    // ---------- sign-in method ----------

    [Fact]
    public void SignInMethod_LocalAccountWithoutIdp_IsEmail()
    {
        Assert.Equal(SignInMethodClaim.Email, SignInMethodClaim.Read(Principal()));
        Assert.Equal(SignInMethodClaim.Email, SignInMethodClaim.Read(Principal(
            ("iss", "https://tenant.ciamlogin.com/tenant/v2.0"), ("idp", "https://tenant.ciamlogin.com/tenant/v2.0"))));
    }

    [Theory]
    [InlineData("google.com", SignInMethodClaim.Google)]
    [InlineData("https://accounts.google.com", SignInMethodClaim.Google)]
    [InlineData("apple.com", SignInMethodClaim.Apple)]
    [InlineData("https://appleid.apple.com", SignInMethodClaim.Apple)]
    [InlineData("facebook.com", SignInMethodClaim.Unknown)]
    [InlineData("https://login.microsoftonline.com/other-tenant/v2.0", SignInMethodClaim.Unknown)]
    public void SignInMethod_FederatedIdp_IsMappedOrUnknown_NeverGuessed(string idp, string expected)
    {
        Assert.Equal(expected, SignInMethodClaim.Read(Principal(("idp", idp))));
        // Same when the JWT handler renamed the claim to its WS-* type.
        Assert.Equal(expected, SignInMethodClaim.Read(Principal(("http://schemas.microsoft.com/identity/claims/identityprovider", idp))));
    }

    // ---------- profile endpoint ----------

    [Fact]
    public async Task Profile_CarriesTheSignInMethodFromTheToken()
    {
        var controller = ProfileController(new UserProfileService(new UserDisplayNameTests.FakeProfileStore(), TimeProvider.System));

        var profile = Assert.IsType<UserProfileDto>(Assert.IsType<OkObjectResult>(await controller.GetAsync(CancellationToken.None)).Value);
        Assert.Equal(SignInMethodClaim.Email, profile.SignInMethod);
        Assert.Equal("K7MP4Q8N", profile.JupleId);
    }

    [Theory]
    [InlineData("Juple", NicknameErrorCodes.Reserved)]
    [InlineData("fuck", NicknameErrorCodes.Prohibited)]
    [InlineData("a\u202Eb", NicknameErrorCodes.InvalidCharacters)]
    [InlineData("가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가가", NicknameErrorCodes.TooLong)]
    public async Task SetNickname_Rejected_Is400WithAStableCode(string nickname, string expectedCode)
    {
        var store = new UserDisplayNameTests.FakeProfileStore { Name = "피카츄" };
        var controller = ProfileController(new UserProfileService(store, TimeProvider.System));

        var result = Assert.IsType<BadRequestObjectResult>(await controller.SetDisplayNameAsync(
            new UserProfileController.SetDisplayNameRequest(nickname), CancellationToken.None));
        var problem = Assert.IsType<ValidationProblemDetails>(result.Value);
        Assert.Equal(expectedCode, problem.Extensions["code"]);
        Assert.Equal("피카츄", store.Name);
    }

    // ---------- profile photo ----------

    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0];

    [Fact]
    public async Task ProfileImage_Upload_StoresUnderTheUsersOwnPrefix_AndReturnsUrlAndVersion()
    {
        var store = new UserDisplayNameTests.FakeProfileStore();
        var storage = new FakeProfileImageStorage();
        var service = new UserProfileService(store, TimeProvider.System, storage);

        var profile = await service.SetProfileImageAsync(UserId, Png);

        var blob = Assert.Single(storage.Blobs);
        Assert.StartsWith($"items/{UserId}/profile/", blob);
        Assert.Equal(blob, store.BlobName);
        Assert.NotNull(profile.ProfileImageUrl);
        Assert.Equal(UserProfileImageVersion.From(blob), profile.ProfileImageVersion);
        Assert.DoesNotContain(blob, profile.ProfileImageVersion!); // storage layout never leaves the server
    }

    [Fact]
    public async Task ProfileImage_Replace_DeletesTheOldBlobOnlyAfterTheRowChanged_AndChangesTheVersion()
    {
        var store = new UserDisplayNameTests.FakeProfileStore();
        var storage = new FakeProfileImageStorage();
        var service = new UserProfileService(store, TimeProvider.System, storage);

        var first = await service.SetProfileImageAsync(UserId, Png);
        var firstBlob = store.BlobName!;
        var second = await service.SetProfileImageAsync(UserId, Jpeg);

        Assert.NotEqual(first.ProfileImageVersion, second.ProfileImageVersion);
        Assert.Equal([firstBlob], storage.Deleted);
        Assert.Equal([store.BlobName!], storage.Blobs);
    }

    [Fact]
    public async Task ProfileImage_Version_IsStableAcrossReads_WhileTheSignedUrlIsNot()
    {
        var store = new UserDisplayNameTests.FakeProfileStore();
        var storage = new FakeProfileImageStorage();
        var service = new UserProfileService(store, TimeProvider.System, storage);
        await service.SetProfileImageAsync(UserId, Png);

        var a = await service.GetAsync(UserId);
        var b = await service.GetAsync(UserId);
        Assert.Equal(a.ProfileImageVersion, b.ProfileImageVersion);
        Assert.NotEqual(a.ProfileImageUrl, b.ProfileImageUrl);
    }

    [Fact]
    public async Task ProfileImage_WhenTheRowCannotBeSaved_KeepsThePreviousPhoto_AndRemovesTheNewBlob()
    {
        var store = new UserDisplayNameTests.FakeProfileStore();
        var storage = new FakeProfileImageStorage();
        var service = new UserProfileService(store, TimeProvider.System, storage);
        await service.SetProfileImageAsync(UserId, Png);
        var kept = store.BlobName!;

        store.FailNextImageWrite = true;
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.SetProfileImageAsync(UserId, Jpeg));

        Assert.Equal(kept, store.BlobName);
        Assert.Equal([kept], storage.Blobs);
    }

    [Fact]
    public async Task ProfileImage_ContentIsCheckedByItsOwnBytes_AndSize()
    {
        var store = new UserDisplayNameTests.FakeProfileStore();
        var storage = new FakeProfileImageStorage();
        var service = new UserProfileService(store, TimeProvider.System, storage);

        await Assert.ThrowsAsync<InvalidItemImageException>(() => service.SetProfileImageAsync(UserId, null));
        await Assert.ThrowsAsync<InvalidItemImageException>(() => service.SetProfileImageAsync(UserId, []));
        await Assert.ThrowsAsync<InvalidItemImageException>(() => service.SetProfileImageAsync(UserId, "GIF89a..."u8.ToArray()));
        var oversized = new byte[UserProfileService.MaxProfileImageByteLength + 1];
        Png.CopyTo(oversized, 0);
        await Assert.ThrowsAsync<InvalidItemImageException>(() => service.SetProfileImageAsync(UserId, oversized));

        Assert.Empty(storage.Blobs);
        Assert.Null(store.BlobName);
    }

    [Fact]
    public async Task ProfileImage_Remove_ClearsTheRowThenDeletesTheBlob_AndIsIdempotent()
    {
        var store = new UserDisplayNameTests.FakeProfileStore();
        var storage = new FakeProfileImageStorage();
        var service = new UserProfileService(store, TimeProvider.System, storage);
        await service.SetProfileImageAsync(UserId, Png);

        var removed = await service.RemoveProfileImageAsync(UserId);
        Assert.Null(removed.ProfileImageUrl);
        Assert.Null(removed.ProfileImageVersion);
        Assert.Null(store.BlobName);
        Assert.Empty(storage.Blobs);

        var again = await service.RemoveProfileImageAsync(UserId);
        Assert.Null(again.ProfileImageUrl);
        Assert.Single(storage.Deleted);
    }

    [Fact]
    public async Task ProfileImage_ThatCannotBeSigned_IsReportedAsNoPhoto()
    {
        var store = new UserDisplayNameTests.FakeProfileStore { BlobName = $"items/{UserId}/profile/x.png" };
        var service = new UserProfileService(store, TimeProvider.System, new FakeProfileImageStorage { FailSigning = true });

        var profile = await service.GetAsync(UserId);
        Assert.Null(profile.ProfileImageUrl);
        Assert.Null(profile.ProfileImageVersion);
    }

    [Fact]
    public async Task ProfileImage_Endpoints_OnlyEverActOnTheAuthenticatedUser()
    {
        // The route has no user id at all - the only user the controller can act on is the one the
        // token resolves to. Another person's photo can therefore never be replaced or removed.
        var service = new RecordingProfileService();
        var controller = ProfileController(service);
        await controller.RemoveImageAsync(CancellationToken.None);
        Assert.Equal([UserId], service.UserIds);

        Assert.DoesNotContain(
            typeof(UserProfileController).GetMethods().SelectMany(method => method.GetParameters()),
            parameter => parameter.Name is "userId" or "jupleId" or "id");
    }

    [Fact]
    public void ProfileImageBlob_IsInsideTheAccountDeletionCleanupPrefix()
    {
        // Account deletion removes every Blob under IItemImageStorage.GetUserBlobPrefix ("items/{userId}/")
        // - the profile photo prefix is inside it, so no new cleanup path is needed.
        Assert.StartsWith($"items/{UserId}/", FakeProfileImageStorage.PrefixFor(UserId));
    }

    // ---------- helpers ----------

    private static ClaimsPrincipal Principal(params (string Type, string Value)[] claims) =>
        new(new ClaimsIdentity(claims.Select(claim => new Claim(claim.Type, claim.Value)), "Bearer"));

    private static T WithClaims<T>(T controller, params Claim[] claims)
        where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "Bearer")) },
        };
        return controller;
    }

    private static UserProfileController ProfileController(IUserProfileService service) =>
        WithClaims(new UserProfileController(new FixedIdentity(), new FixedUser(UserId), service));

    private sealed class FixedIdentity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class FixedUser(long userId) : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CurrentJupleUser(userId, "UTC", UserPlan.Free));
    }

    private sealed class MissingUser : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            throw new CurrentJupleUserNotFoundException();
    }

    /// <summary>The real service's recent-auth rule in front of a recording delete.</summary>
    private sealed class RecordingDeleteAccountService : IDeleteAccountService
    {
        public long? DeletedUserId { get; private set; }

        public Task DeleteAsync(long userId, CancellationToken cancellationToken = default)
        {
            DeletedUserId = userId;
            return Task.CompletedTask;
        }

        public Task DeleteRecentlyAuthenticatedAsync(long userId, DateTimeOffset? authenticatedAtUtc, CancellationToken cancellationToken = default)
        {
            Juple.Application.Collections.Locking.RecentAuthentication.Require(authenticatedAtUtc, DateTimeOffset.UtcNow);
            return DeleteAsync(userId, cancellationToken);
        }
    }

    private sealed class RecordingProfileService : IUserProfileService
    {
        public List<long> UserIds { get; } = [];

        private Task<UserProfileDto> Record(long userId)
        {
            UserIds.Add(userId);
            return Task.FromResult(new UserProfileDto(null, "K7MP4Q8N"));
        }

        public Task<UserProfileDto> GetAsync(long userId, CancellationToken cancellationToken = default) => Record(userId);

        public Task<UserProfileDto> SetDisplayNameAsync(long userId, string? displayName, CancellationToken cancellationToken = default) => Record(userId);

        public Task<UserProfileDto> SetProfileImageAsync(long userId, byte[]? content, CancellationToken cancellationToken = default) => Record(userId);

        public Task<UserProfileDto> RemoveProfileImageAsync(long userId, CancellationToken cancellationToken = default) => Record(userId);
    }

    internal sealed class FakeProfileImageStorage : IUserProfileImageStorage
    {
        private int signCount;

        public static string PrefixFor(long userId) => $"items/{userId}/profile/";

        public List<string> Blobs { get; } = [];

        public List<string> Deleted { get; } = [];

        public bool FailSigning { get; init; }

        public Task<string> UploadProfileImageAsync(long userId, ImageFormat format, byte[] content, CancellationToken cancellationToken = default)
        {
            var name = $"{PrefixFor(userId)}{Guid.NewGuid():N}.{format.ToString().ToLowerInvariant()}";
            Blobs.Add(name);
            return Task.FromResult(name);
        }

        public Task DeleteProfileImageAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            Blobs.Remove(blobName);
            Deleted.Add(blobName);
            return Task.CompletedTask;
        }

        public Task<Uri?> CreateProfileImageReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult(FailSigning ? null : new Uri($"https://blob.example/{blobName}?sig={++signCount}"));
    }
}
