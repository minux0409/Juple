using System.Text.Json;
using Juple.Api.Collections;
using Juple.Api.Controllers;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Comments;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class CollectionItemCommentServiceTests
{
    [Theory]
    [InlineData("  hello  ", "hello")]
    [InlineData("a\r\nb", "a\nb")]
    [InlineData("a\rb", "a\nb")]
    [InlineData("tab\there", "tab\there")]
    [InlineData("<b>x</b> & \"y\"", "<b>x</b> & \"y\"")]
    [InlineData("😀 가나다 العربية", "😀 가나다 العربية")]
    public void TheBodyIsTrimmed_LineBreaksAreNormalized_AndTextIsKeptAsTyped(string input, string expected) =>
        Assert.Equal(expected, CollectionCommentBody.Normalize(input));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" \n\t ")]
    [InlineData("null\0byte")]
    [InlineData("bell\a")]
    [InlineData("escape\u001b[0m")]
    public void EmptyBlankAndControlCharacterBodiesAreRejected(string? input) =>
        Assert.Throws<InvalidCollectionException>(() => CollectionCommentBody.Normalize(input));

    [Fact]
    public void TheLimitIs1000Characters_AfterTrimming()
    {
        Assert.Equal(1000, CollectionCommentBody.Normalize(new string('a', 1000)).Length);
        Assert.Equal(1000, CollectionCommentBody.Normalize("  " + new string('a', 1000) + "  ").Length);
        Assert.Throws<InvalidCollectionException>(() => CollectionCommentBody.Normalize(new string('a', 1001)));
    }

    [Fact]
    public async Task ABadBodyIsRejectedBeforeAnythingElseIsAsked()
    {
        var access = new FakeAccess();
        var service = new CollectionItemCommentService(access, new FakeStore(), TimeProvider.System);

        await Assert.ThrowsAsync<InvalidCollectionException>(() => service.CreateAsync(1, 2, 3, "   ", null));

        Assert.Equal(0, access.Calls);
    }

    [Fact]
    public async Task TheContentGateComesFirst_SoANonMemberOrALockedCollectionNeverReachesTheStore()
    {
        var store = new FakeStore();
        var service = new CollectionItemCommentService(new FakeAccess { Throw = new CollectionNotFoundException() }, store, TimeProvider.System);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.ListAsync(1, 2, 3, null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.CreateAsync(1, 2, 3, "hi", null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.DeleteAsync(1, 2, 3, 4, null));

        Assert.Equal(0, store.Calls);
    }

    [Fact]
    public async Task TheUnlockTokenIsPassedToTheGate_AndTheOwnerFlagToTheDelete()
    {
        var access = new FakeAccess { IsOwner = true };
        var store = new FakeStore();
        var service = new CollectionItemCommentService(access, store, TimeProvider.System);

        await service.DeleteAsync(1, 2, 3, 4, "grant");

        Assert.Equal("grant", access.LastToken);
        Assert.True(store.LastIsOwner);
    }

    [Fact]
    public async Task ADeleteByAnotherMember_IsForbidden_AndAnAbsentCommentIsASuccess()
    {
        await Assert.ThrowsAsync<CollectionForbiddenException>(() =>
            new CollectionItemCommentService(new FakeAccess(), new FakeStore { Delete = CommentDeleteResult.NotAllowed }, TimeProvider.System).DeleteAsync(1, 2, 3, 4, null));

        await new CollectionItemCommentService(new FakeAccess(), new FakeStore { Delete = CommentDeleteResult.Absent }, TimeProvider.System).DeleteAsync(1, 2, 3, 4, null);
    }

    [Fact]
    public async Task ANonLinkIsNotFound_ForEveryOperation()
    {
        var service = new CollectionItemCommentService(new FakeAccess(), new FakeStore { IsLink = false }, TimeProvider.System);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.ListAsync(1, 2, 3, null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.CreateAsync(1, 2, 3, "hi", null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.DeleteAsync(1, 2, 3, 4, null));
    }

    [Theory]
    [InlineData(null, 30)]
    [InlineData(10, 10)]
    [InlineData(5000, 100)]
    public async Task ThePageSizeDefaultsToThirtyAndIsCappedAtOneHundred(int? requested, int expected)
    {
        var store = new FakeStore();
        var service = new CollectionItemCommentService(new FakeAccess(), store, TimeProvider.System);

        await service.ListAsync(1, 2, 3, null, requested, null);

        Assert.Equal(expected, store.LastLimit);
    }

    [Theory]
    [InlineData(0, null)]
    [InlineData(-1, null)]
    [InlineData(10, -3L)]
    public async Task NonPositivePagingArgumentsAreRejected(int limit, long? before)
    {
        var service = new CollectionItemCommentService(new FakeAccess(), new FakeStore(), TimeProvider.System);

        await Assert.ThrowsAsync<InvalidCollectionException>(() => service.ListAsync(1, 2, 3, before, limit, null));
    }

    [Theory]
    [InlineData("""{"body":"hello"}""", "hello")]
    [InlineData("""{"body":null}""", null)]
    [InlineData("""{}""", null)]
    public void TheBodyBindsTheText(string json, string? body) =>
        Assert.Equal(body, JsonSerializer.Deserialize<CollectionsController.PostCommentRequest>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!.Body);

    [Theory]
    [InlineData("ListCommentsAsync")]
    [InlineData("AddCommentAsync")]
    [InlineData("DeleteCommentAsync")]
    public void TheEndpointsDeclareNoOwnerOnlyPermission_TheServiceGatesThem(string actionName)
    {
        var action = typeof(CollectionsController).GetMethod(actionName)!;

        Assert.Null(action.GetCustomAttributes(typeof(CollectionPermissionAttribute), true).FirstOrDefault());
    }

    [Fact]
    public async Task ANewComment_IsAnnounced_WithoutItsText_AndDeletingOrAFailedCommentIsNot()
    {
        var publisher = new CollectionLockScopeTests.RecordingSocialPublisher();

        await new CollectionItemCommentService(new FakeAccess(), new FakeStore(), TimeProvider.System, publisher).CreateAsync(1, 2, 3, "secret words", null);
        await new CollectionItemCommentService(new FakeAccess(), new FakeStore(), TimeProvider.System, publisher).DeleteAsync(1, 2, 3, 4, null);
        await Assert.ThrowsAsync<CollectionNotFoundException>(() =>
            new CollectionItemCommentService(new FakeAccess(), new FakeStore { IsLink = false }, TimeProvider.System, publisher).CreateAsync(1, 2, 3, "x", null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() =>
            new CollectionItemCommentService(new FakeAccess(), new FakeStore(), TimeProvider.System, publisher).CreateAsync(1, 2, 3, "   ", null));

        // Only who, where and which link - the publisher is never even handed the text.
        Assert.Equal(["comment:1:2:3"], publisher.Events);
        Assert.DoesNotContain(
            typeof(Juple.Application.Notifications.ISocialNotificationPublisher).GetMethod("CollectionItemCommentReceivedAsync")!.GetParameters(),
            parameter => parameter.ParameterType == typeof(string));
    }

    [Fact]
    public void TheCommentDtosCarryNoEmailProviderOrInternalIdField()
    {
        var names = typeof(CollectionCommentDto).GetProperties().Concat(typeof(CollectionCommentAuthorDto).GetProperties()).Select(property => property.Name);

        Assert.DoesNotContain(names, name => name.Contains("Email", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Provider", StringComparison.OrdinalIgnoreCase)
            || name.Contains("Subject", StringComparison.OrdinalIgnoreCase)
            || name is "UserId" or "AuthorId");
    }

    private sealed class FakeAccess : ICollectionAccessService
    {
        public Exception? Throw { get; init; }

        public bool IsOwner { get; init; }

        public int Calls { get; private set; }

        public string? LastToken { get; private set; }

        public Task<CollectionAccess> RequireAsync(long userId, long collectionId, CollectionPermission permission, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionAccess> RequireUnlockedAsync(long userId, long collectionId, CollectionPermission permission, string? unlockToken, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<CollectionAccess> RequireContentAsync(long userId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastToken = unlockToken;
            return Throw is null
                ? Task.FromResult(new CollectionAccess(collectionId, IsOwner ? CollectionAccessRole.Owner : CollectionAccessRole.Contributor, false, 0))
                : Task.FromException<CollectionAccess>(Throw);
        }
    }

    private sealed class FakeStore : ICollectionItemCommentStore
    {
        public bool IsLink { get; init; } = true;

        public CommentDeleteResult Delete { get; init; } = CommentDeleteResult.Deleted;

        public int Calls { get; private set; }

        public int LastLimit { get; private set; }

        public bool LastIsOwner { get; private set; }

        private static CollectionCommentDto Comment() =>
            new(1, "hi", DateTimeOffset.UtcNow, new CollectionCommentAuthorDto("ABCD2345", null, null, null, false, true));

        public Task<CollectionCommentPageDto?> GetPageAsync(long userId, long collectionId, long itemId, long? beforeId, int limit, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastLimit = limit;
            return Task.FromResult<CollectionCommentPageDto?>(IsLink ? new CollectionCommentPageDto([], null, 0) : null);
        }

        public Task<CollectionCommentDto?> CreateAsync(long userId, long collectionId, long itemId, string body, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult<CollectionCommentDto?>(IsLink ? Comment() : null);
        }

        public Task<CommentDeleteResult?> DeleteAsync(long userId, long collectionId, long itemId, long commentId, bool isOwner, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastIsOwner = isOwner;
            return Task.FromResult<CommentDeleteResult?>(IsLink ? Delete : null);
        }
    }
}
