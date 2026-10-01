using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.Comments;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.Reactions;
using Juple.Application.Images;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// Comments against a real SQL Server schema: who may read, write and delete (the Owner and accepted
/// members of any role; deleting only one's own - or any, for the Owner), the text rules, links only
/// (never a pending proposal or a trashed Item), the content lock respected (the Owner included),
/// clean-up with the link / the Collection / the Item / the account - but NOT when the author merely
/// leaves the Collection - stable cursor paging, and pages whose authors are loaded in a fixed number
/// of statements.
/// </summary>
public sealed class CollectionItemCommentIntegrationTests : IAsyncLifetime
{
    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _viewer;
    private long _submitter;
    private long _contributor;
    private long _pending;
    private long _outsider;
    private long _sharedId;
    private long _item1;
    private long _item2;

    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private CollectionCollaborationService _collaboration = null!;
    private CollectionUnlockTokenProtector _tokens = null!;
    private CollectionItemCommentService _comments = null!;
    private readonly FakeProfileImageStorage _photos = new();

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = NewContext();

        _owner = await NewUserAsync();
        _viewer = await NewUserAsync();
        _submitter = await NewUserAsync();
        _contributor = await NewUserAsync();
        _pending = await NewUserAsync();
        _outsider = await NewUserAsync();

        _collections = new CollectionStore(_db);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(_access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _comments = new CollectionItemCommentService(_access, new CollectionItemCommentStore(_db, _photos), TimeProvider.System);

        _sharedId = (await _collections.CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await InviteAndAcceptAsync(_submitter, CollectionCollaboratorRole.Submitter);
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pending), CollectionCollaboratorRole.Viewer);

        _item1 = await NewItemAsync(_owner, "https://example.test/one");
        _item2 = await NewItemAsync(_owner, "https://example.test/two");
        await _collections.AddAsync(_owner, _sharedId, _item1, DateTimeOffset.UtcNow);
        await _collections.AddAsync(_owner, _sharedId, _item2, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext(params IInterceptor[] interceptors) =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).AddInterceptors(interceptors).Options);

    // ---------- who may read and write ----------

    [Theory]
    [InlineData("owner")]
    [InlineData("viewer")]
    [InlineData("submitter")]
    [InlineData("contributor")]
    public async Task TheOwnerAndEveryAcceptedRole_MayWriteAndRead(string who)
    {
        var userId = UserOf(who);

        var created = await _comments.CreateAsync(userId, _sharedId, _item1, "Looks good", null);
        var page = await _comments.ListAsync(userId, _sharedId, _item1, null, null, null);

        Assert.Equal("Looks good", created.Body);
        Assert.True(created.Author.IsMe);
        Assert.Equal(who == "owner", created.Author.IsCollectionOwner);
        Assert.Single(page.Items);
        Assert.Equal(created.Id, page.Items[0].Id);
        Assert.Equal(1, page.TotalCount);
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("outsider")]
    public async Task APendingInviteeAndANonMember_AreToldItDoesNotExist_ForEveryOperation(string who)
    {
        var userId = UserOf(who);
        var existing = await _comments.CreateAsync(_owner, _sharedId, _item1, "hello", null);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.ListAsync(userId, _sharedId, _item1, null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(userId, _sharedId, _item1, "hi", null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.DeleteAsync(userId, _sharedId, _item1, existing.Id, null));
        Assert.Equal(1, await _db.CollectionItemComments.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task APublicLinkHolderWhoIsNotAMember_CannotReadOrWrite_EvenWhenTheLinkIsOn()
    {
        await new CollectionShareStore(_db).EnableAsync(_owner, _sharedId, "public-r31", DateTimeOffset.UtcNow, CollectionSharePermission.Write, raiseLowerRoles: true);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.ListAsync(_outsider, _sharedId, _item1, null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_outsider, _sharedId, _item1, "hi", null));
    }

    // ---------- the text ----------

    [Fact]
    public async Task TheBodyIsTrimmed_NewlinesAreKept_AndStoredExactlyAsTyped_NeverSanitizedIntoHtml()
    {
        var created = await _comments.CreateAsync(_viewer, _sharedId, _item1, "  line one\r\nline <b>two</b> & \"three\"  \n", null);

        Assert.Equal("line one\nline <b>two</b> & \"three\"", created.Body);
        Assert.Equal(created.Body, (await _comments.ListAsync(_viewer, _sharedId, _item1, null, null, null)).Items[0].Body);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n\t  ")]
    public async Task AnEmptyOrBlankBodyIsRejected(string? body)
    {
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.CreateAsync(_viewer, _sharedId, _item1, body, null));

        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task ExactlyTheLimitIsAccepted_OneMoreIsRejected_AndControlCharactersAreRefused()
    {
        var ok = await _comments.CreateAsync(_viewer, _sharedId, _item1, new string('가', CollectionCommentBody.MaxLength), null);
        Assert.Equal(1000, ok.Body.Length);

        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.CreateAsync(_viewer, _sharedId, _item1, new string('a', 1001), null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.CreateAsync(_viewer, _sharedId, _item1, "null\0byte", null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.CreateAsync(_viewer, _sharedId, _item1, "bell\a", null));
        Assert.Equal(1, await _db.CollectionItemComments.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task TheAuthorIsTheCallerAndNobodyElse_ShownByNameAndPhotoButNeverByEmailOrInternalId()
    {
        await SetProfilePhotoAsync(_contributor, $"users/{_contributor}/profile/a.jpg");
        var created = await _comments.CreateAsync(_contributor, _sharedId, _item1, "mine", null);

        var asOwner = (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).Items.Single();
        Assert.Equal(created.Id, asOwner.Id);
        Assert.Equal(await JupleIdOfAsync(_contributor), asOwner.Author.JupleId);
        Assert.False(asOwner.Author.IsMe);
        Assert.False(asOwner.Author.IsCollectionOwner);
        Assert.NotNull(asOwner.Author.ProfileImageUrl);
        Assert.NotNull(asOwner.Author.ProfileImageVersion);
        // Only these author fields exist - nothing that could carry an email, a provider id or the internal UserId.
        Assert.Equal(
            ["DisplayName", "IsCollectionOwner", "IsMe", "JupleId", "ProfileImageUrl", "ProfileImageVersion"],
            typeof(CollectionCommentAuthorDto).GetProperties().Select(property => property.Name).Order().ToArray());
        Assert.DoesNotContain(typeof(CollectionCommentDto).GetProperties(), property => property.Name.Contains("UserId", StringComparison.Ordinal));
    }

    // ---------- deleting ----------

    [Fact]
    public async Task AnAuthorDeletesTheirOwn_TheOwnerDeletesAnyones_AnotherMemberCannotDeleteSomeoneElses()
    {
        var byViewer = await _comments.CreateAsync(_viewer, _sharedId, _item1, "viewer's", null);
        var bySubmitter = await _comments.CreateAsync(_submitter, _sharedId, _item1, "submitter's", null);
        var byContributor = await _comments.CreateAsync(_contributor, _sharedId, _item1, "contributor's", null);

        // Own: fine.
        await _comments.DeleteAsync(_viewer, _sharedId, _item1, byViewer.Id, null);
        // Someone else's, by another member (of any role): refused, nothing removed.
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _comments.DeleteAsync(_viewer, _sharedId, _item1, bySubmitter.Id, null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _comments.DeleteAsync(_contributor, _sharedId, _item1, bySubmitter.Id, null));
        Assert.Equal(2, (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).TotalCount);
        // The Owner: any.
        await _comments.DeleteAsync(_owner, _sharedId, _item1, bySubmitter.Id, null);
        await _comments.DeleteAsync(_owner, _sharedId, _item1, byContributor.Id, null);

        Assert.Equal(0, (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).TotalCount);
    }

    [Fact]
    public async Task DeletingOneThatIsAlreadyGone_IsASuccess_ButAnotherLinksCommentIsNeverReachedThroughThisLink()
    {
        var comment = await _comments.CreateAsync(_viewer, _sharedId, _item1, "gone soon", null);
        await _comments.DeleteAsync(_viewer, _sharedId, _item1, comment.Id, null);

        await _comments.DeleteAsync(_viewer, _sharedId, _item1, comment.Id, null);
        await _comments.DeleteAsync(_owner, _sharedId, _item1, 999_999_999, null);

        // A comment of item 2 cannot be removed by naming item 1 in the path.
        var other = await _comments.CreateAsync(_viewer, _sharedId, _item2, "on two", null);
        await _comments.DeleteAsync(_owner, _sharedId, _item1, other.Id, null);
        Assert.Equal(1, (await _comments.ListAsync(_owner, _sharedId, _item2, null, null, null)).TotalCount);
    }

    // ---------- only links ----------

    [Fact]
    public async Task AnItemThatIsNotALinkOfTheCollection_IsNotFound_ForReadWriteAndDelete()
    {
        var stranger = await NewItemAsync(_owner, "https://example.test/not-linked");

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.ListAsync(_owner, _sharedId, stranger, null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_owner, _sharedId, stranger, "hi", null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.DeleteAsync(_owner, _sharedId, stranger, 1, null));
    }

    [Fact]
    public async Task APendingProposal_CannotBeCommentedOn_UntilItIsApproved()
    {
        var proposed = await NewItemAsync(_submitter, "https://example.test/proposed");
        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Submitted,
            await new CollectionLinkSubmissionStore(_db).SubmitAsync(_submitter, _sharedId, proposed, null, DateTimeOffset.UtcNow));

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_owner, _sharedId, proposed, "hi", null));
    }

    [Fact]
    public async Task AnItemInTheTrash_IsNotCommentable_AndItsConversationIsNotReadable()
    {
        await _comments.CreateAsync(_owner, _sharedId, _item2, "before the trash", null);
        await _db.Items.Where(item => item.Id == _item2).ExecuteUpdateAsync(setters => setters.SetProperty(item => item.DeletedAtUtc, DateTimeOffset.UtcNow));
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.ListAsync(_owner, _sharedId, _item2, null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_owner, _sharedId, _item2, "hi", null));
    }

    // ---------- the content lock ----------

    [Fact]
    public async Task ALockedCollection_NeedsItsGrant_ForReadWriteAndDelete_AndTheOwnerIsNoException()
    {
        var existing = await _comments.CreateAsync(_owner, _sharedId, _item1, "before the lock", null);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE collections.Collections SET IsLocked = 1, LockPasswordHash = {"hash"}, LockPasswordChangedAtUtc = {DateTimeOffset.UtcNow}, LockVersion = LockVersion + 1 WHERE Id = {_sharedId}");
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionLockedException>(() => _comments.ListAsync(_owner, _sharedId, _item1, null, null, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _comments.CreateAsync(_owner, _sharedId, _item1, "hi", null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _comments.DeleteAsync(_owner, _sharedId, _item1, existing.Id, null));
        Assert.Equal(1, await _db.CollectionItemComments.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    // ---------- paging ----------

    [Fact]
    public async Task PagingStartsAtTheNewestAndWalksBackwards_WithNoDuplicateAndNoMissingComment()
    {
        var ids = new List<long>();
        for (var index = 0; index < 25; index++)
        {
            ids.Add((await _comments.CreateAsync(index % 2 == 0 ? _viewer : _contributor, _sharedId, _item1, $"comment {index}", null)).Id);
        }

        var first = await _comments.ListAsync(_owner, _sharedId, _item1, null, 10, null);
        Assert.Equal(25, first.TotalCount);
        Assert.Equal(ids.Skip(15), first.Items.Select(comment => comment.Id));
        Assert.Equal(ids[15], first.PreviousCursor);

        var second = await _comments.ListAsync(_owner, _sharedId, _item1, first.PreviousCursor, 10, null);
        Assert.Equal(ids.Skip(5).Take(10), second.Items.Select(comment => comment.Id));
        Assert.Equal(ids[5], second.PreviousCursor);

        var last = await _comments.ListAsync(_owner, _sharedId, _item1, second.PreviousCursor, 10, null);
        Assert.Equal(ids.Take(5), last.Items.Select(comment => comment.Id));
        Assert.Null(last.PreviousCursor);

        var everything = second.Items.Concat(first.Items).Prepend(null!).Skip(1).Select(comment => comment.Id).Concat(last.Items.Select(comment => comment.Id));
        Assert.Equal(25, everything.Distinct().Count());
    }

    [Fact]
    public async Task EqualTimestamps_AreOrderedByIdSoTheOrderAndTheCursorStayStable()
    {
        var sameInstant = new DateTimeOffset(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);
        var ids = new List<long>();
        for (var index = 0; index < 6; index++)
        {
            var comment = new CollectionItemComment(_sharedId, _item1, _viewer, $"same moment {index}", sameInstant);
            _db.CollectionItemComments.Add(comment);
            await _db.SaveChangesAsync();
            ids.Add(comment.Id);
        }

        var newest = await _comments.ListAsync(_owner, _sharedId, _item1, null, 3, null);
        var older = await _comments.ListAsync(_owner, _sharedId, _item1, newest.PreviousCursor, 3, null);

        Assert.Equal(ids.Skip(3), newest.Items.Select(comment => comment.Id));
        Assert.Equal(ids.Take(3), older.Items.Select(comment => comment.Id));
        Assert.Null(older.PreviousCursor);
    }

    [Fact]
    public async Task AnEmptyConversationAnd_BadPagingArguments()
    {
        var empty = await _comments.ListAsync(_viewer, _sharedId, _item1, null, null, null);
        Assert.Empty(empty.Items);
        Assert.Null(empty.PreviousCursor);
        Assert.Equal(0, empty.TotalCount);

        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.ListAsync(_viewer, _sharedId, _item1, null, 0, null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.ListAsync(_viewer, _sharedId, _item1, -5, 10, null));
        // A page size above the maximum is capped, not refused.
        for (var index = 0; index < 3; index++)
        {
            await _comments.CreateAsync(_viewer, _sharedId, _item1, $"c{index}", null);
        }

        Assert.Equal(3, (await _comments.ListAsync(_viewer, _sharedId, _item1, null, 5000, null)).Items.Count);
    }

    [Fact]
    public async Task EachLinkHasItsOwnConversation()
    {
        await _comments.CreateAsync(_viewer, _sharedId, _item1, "on one", null);
        await _comments.CreateAsync(_viewer, _sharedId, _item2, "on two", null);
        await _comments.CreateAsync(_viewer, _sharedId, _item2, "also two", null);

        Assert.Equal(1, (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).TotalCount);
        Assert.Equal(2, (await _comments.ListAsync(_owner, _sharedId, _item2, null, null, null)).TotalCount);
    }

    // ---------- query shape ----------

    [Fact]
    public async Task APageOf30Comments_LoadsItsAuthorsInAFixedNumberOfStatements_AndSignsEachPhotoOnce()
    {
        await SetProfilePhotoAsync(_viewer, $"users/{_viewer}/profile/v.jpg");
        await SetProfilePhotoAsync(_contributor, $"users/{_contributor}/profile/c.jpg");
        for (var index = 0; index < 30; index++)
        {
            await _comments.CreateAsync(index % 3 == 0 ? _viewer : index % 3 == 1 ? _contributor : _owner, _sharedId, _item1, $"comment {index}", null);
        }

        var commands = new CommandCounter();
        await using var counted = NewContext(commands);
        var photos = new FakeProfileImageStorage();
        var service = new CollectionItemCommentService(
            new CollectionAccessService(new CollectionAccessStore(counted), _tokens, TimeProvider.System),
            new CollectionItemCommentStore(counted, photos),
            TimeProvider.System);
        commands.Reset();

        var page = await service.ListAsync(_owner, _sharedId, _item1, null, 30, null);

        Assert.Equal(30, page.Items.Count);
        // Three different authors, 30 comments: each author's photo signed once - never once per comment.
        Assert.Equal(2, photos.SignCount);
        // The access check, the link check, the count, the page, the owner and the authors: a fixed few -
        // the same for 30 comments as for 3.
        Assert.InRange(commands.Count, 1, 12);
        var after30 = commands.Count;

        var small = await _comments.ListAsync(_owner, _sharedId, _item2, null, 30, null);
        Assert.Empty(small.Items);
        Assert.True(after30 <= 12);
    }

    // ---------- clean-up ----------

    [Fact]
    public async Task TakingTheLinkOutOfTheCollection_TakesItsConversationWithIt_AndNothingElse()
    {
        await _comments.CreateAsync(_viewer, _sharedId, _item1, "on one", null);
        await _comments.CreateAsync(_viewer, _sharedId, _item2, "on two", null);

        await _collections.RemoveAsync(_owner, _sharedId, _item1);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == _item1));
        Assert.Equal(1, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == _item2));
    }

    [Fact]
    public async Task DeletingTheItemOrTheCollection_LeavesNoCommentBehind()
    {
        var other = (await _collections.CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var doomed = await NewItemAsync(_owner, "https://example.test/doomed");
        await _collections.AddAsync(_owner, other, doomed, DateTimeOffset.UtcNow);
        await _collections.AddAsync(_owner, _sharedId, doomed, DateTimeOffset.UtcNow);
        await _comments.CreateAsync(_owner, _sharedId, doomed, "a", null);
        await _comments.CreateAsync(_owner, other, doomed, "b", null);
        await _comments.CreateAsync(_owner, _sharedId, _item1, "c", null);

        await _db.Items.Where(item => item.Id == doomed).ExecuteDeleteAsync();
        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == doomed));

        await _db.Collections.Where(collection => collection.Id == _sharedId).ExecuteDeleteAsync();
        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task AMemberLeavingTheCollection_DoesNotRemoveTheirComments_TheConversationKeepsItsContext()
    {
        await SetProfilePhotoAsync(_contributor, $"users/{_contributor}/profile/c.jpg");
        var comment = await _comments.CreateAsync(_contributor, _sharedId, _item1, "I was here", null);
        await _comments.CreateAsync(_viewer, _sharedId, _item1, "me too", null);

        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, await JupleIdOfAsync(_contributor));

        _db.ChangeTracker.Clear();
        var page = await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null);
        Assert.Equal(2, page.TotalCount);
        var kept = page.Items.Single(entry => entry.Id == comment.Id);
        Assert.Equal("I was here", kept.Body);
        // Still shown by name and photo, no longer a member - and they can no longer read or write.
        Assert.Equal(await JupleIdOfAsync(_contributor), kept.Author.JupleId);
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.ListAsync(_contributor, _sharedId, _item1, null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_contributor, _sharedId, _item1, "back again", null));
    }

    [Fact]
    public async Task DeletingAnAccount_RemovesItsCommentsEverywhere_AndNobodyElses()
    {
        await _comments.CreateAsync(_contributor, _sharedId, _item1, "mine", null);
        await _comments.CreateAsync(_contributor, _sharedId, _item2, "mine too", null);
        await _comments.CreateAsync(_viewer, _sharedId, _item1, "stays", null);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_contributor, $"test/{_contributor}/", DateTimeOffset.UtcNow);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.UserId == _contributor));
        Assert.Equal(1, await _db.CollectionItemComments.CountAsync(entry => entry.UserId == _viewer));
        _userIds.Remove(_contributor);
    }

    [Fact]
    public async Task TheOwnersAccountDeletion_RemovesTheWholeCollectionAndEveryCommentOnIt()
    {
        await _comments.CreateAsync(_viewer, _sharedId, _item1, "from the viewer", null);
        await _comments.CreateAsync(_owner, _sharedId, _item1, "from the owner", null);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_owner, $"test/{_owner}/", DateTimeOffset.UtcNow);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.CollectionId == _sharedId));
        _userIds.Remove(_owner);
    }

    // ---------- reactions and comments stay independent ----------

    [Fact]
    public async Task ReactionsAndComments_DoNotInterfere_OnTheSameLink()
    {
        var reactions = new CollectionItemReactionService(_access, new CollectionItemReactionStore(_db), TimeProvider.System);
        await reactions.SetAsync(_viewer, _sharedId, _item1, "heart", null);
        await _comments.CreateAsync(_viewer, _sharedId, _item1, "nice", null);

        await _comments.DeleteAsync(_owner, _sharedId, _item1, (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).Items[0].Id, null);

        Assert.Equal(1, await _db.CollectionItemReactions.CountAsync(entry => entry.ItemId == _item1));
        // And the page of links does not carry comments at all.
        Assert.DoesNotContain(typeof(CollectionItemEntryDto).GetProperties(), property => property.Name.Contains("Comment", StringComparison.OrdinalIgnoreCase));
    }

    // ---------- helpers ----------

    private long UserOf(string who) => who switch
    {
        "owner" => _owner,
        "viewer" => _viewer,
        "submitter" => _submitter,
        "contributor" => _contributor,
        "pending" => _pending,
        _ => _outsider,
    };

    private async Task InviteAndAcceptAsync(long inviteeId, CollectionCollaboratorRole role)
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(inviteeId), role);
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
        _db.ChangeTracker.Clear();
    }

    private async Task SetProfilePhotoAsync(long userId, string blobName)
    {
        await _db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users.Users SET ProfileImageBlobName = {blobName} WHERE Id = {userId}");
        _db.ChangeTracker.Clear();
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private sealed class CommandCounter : DbCommandInterceptor
    {
        public int Count { get; private set; }

        public void Reset() => Count = 0;

        public override ValueTask<InterceptionResult<System.Data.Common.DbDataReader>> ReaderExecutingAsync(
            System.Data.Common.DbCommand command,
            CommandEventData eventData,
            InterceptionResult<System.Data.Common.DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Count++;
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }

    /// <summary>No Blob I/O; signs deterministically and counts signatures.</summary>
    private sealed class FakeProfileImageStorage : IUserProfileImageStorage
    {
        private int _signCount;

        public int SignCount => _signCount;

        public Task<string> UploadProfileImageAsync(long userId, ImageFormat format, byte[] content, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteProfileImageAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<Uri?> CreateProfileImageReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _signCount);
            return Task.FromResult<Uri?>(new Uri($"https://blob.example/{blobName}"));
        }
    }
}
