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

    // ---------- editing ----------

    [Fact]
    public async Task TheAuthorEditsTheirOwnWords_NothingElseChanges_HeartsAndRepliesStay()
    {
        var top = await _comments.CreateAsync(_contributor, _sharedId, _item1, "first words", null);
        await _comments.CreateAsync(_viewer, _sharedId, _item1, "an answer", null, top.Id);
        await _comments.SetLikeAsync(_owner, _sharedId, _item1, top.Id, true, null);

        var edited = await _comments.EditAsync(_contributor, _sharedId, _item1, top.Id, "  better words  ", null);

        Assert.Equal("better words", edited.Body);
        Assert.Equal(top.Id, edited.Id);
        Assert.Equal(top.CreatedAtUtc, edited.CreatedAtUtc);
        Assert.Equal(1, edited.ReplyCount);
        Assert.Equal(1, edited.LikeCount);
        Assert.True(edited.Author.IsMe);
        var stored = (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).Items.Single();
        Assert.Equal("better words", stored.Body);
        Assert.Equal(1, stored.LikeCount);
    }

    [Fact]
    public async Task EditingAReply_ChangesOnlyItsBody_TheThreadAndTheAnsweredPersonStay()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);
        var first = await _comments.CreateAsync(_viewer, _sharedId, _item1, "first reply", null, top.Id);
        var nested = await _comments.CreateAsync(_contributor, _sharedId, _item1, "to the viewer", null, first.Id);

        var edited = await _comments.EditAsync(_contributor, _sharedId, _item1, nested.Id, "to the viewer, edited", null);

        Assert.Equal("to the viewer, edited", edited.Body);
        Assert.Equal(top.Id, edited.RootCommentId);
        Assert.Equal(first.Id, edited.ParentCommentId);
        Assert.NotNull(edited.ReplyTo);
        Assert.Equal(nested.ReplyTo!.JupleId, edited.ReplyTo!.JupleId);
    }

    [Fact]
    public async Task OnlyTheAuthorMayEdit_NotEvenTheOwner_AndNothingChanges()
    {
        var byViewer = await _comments.CreateAsync(_viewer, _sharedId, _item1, "mine", null);

        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _comments.EditAsync(_owner, _sharedId, _item1, byViewer.Id, "hijacked", null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _comments.EditAsync(_contributor, _sharedId, _item1, byViewer.Id, "hijacked", null));

        Assert.Equal("mine", (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).Items.Single().Body);
        // A Viewer may edit their own (writing a comment never needed more than reading).
        Assert.Equal("still mine", (await _comments.EditAsync(_viewer, _sharedId, _item1, byViewer.Id, "still mine", null)).Body);
    }

    [Fact]
    public async Task ADeletedComment_CannotBeEdited_AndAnotherLinksCommentIsNeverReachedThroughThisLink()
    {
        var top = await _comments.CreateAsync(_viewer, _sharedId, _item1, "words", null);
        await _comments.CreateAsync(_owner, _sharedId, _item1, "answer", null, top.Id);
        await _comments.DeleteAsync(_viewer, _sharedId, _item1, top.Id, null);   // answered, so a tombstone
        var other = await _comments.CreateAsync(_viewer, _sharedId, _item2, "on the other link", null);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.EditAsync(_viewer, _sharedId, _item1, top.Id, "revived", null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.EditAsync(_viewer, _sharedId, _item1, other.Id, "wrong link", null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.EditAsync(_viewer, _sharedId, _item1, 987654321, "missing", null));

        var tombstone = (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).Items.Single();
        Assert.True(tombstone.IsDeleted);
        Assert.Equal(string.Empty, tombstone.Body);
    }

    [Theory]
    [InlineData("pending")]
    [InlineData("outsider")]
    public async Task APendingInviteeAndANonMember_CannotEdit(string who)
    {
        var mine = await _comments.CreateAsync(_viewer, _sharedId, _item1, "words", null);
        var caller = who == "pending" ? _pending : _outsider;

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.EditAsync(caller, _sharedId, _item1, mine.Id, "x", null));
    }

    [Fact]
    public async Task EditingValidatesTheBodyLikeWriting()
    {
        var mine = await _comments.CreateAsync(_viewer, _sharedId, _item1, "words", null);

        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.EditAsync(_viewer, _sharedId, _item1, mine.Id, "   ", null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.EditAsync(_viewer, _sharedId, _item1, mine.Id, new string('a', 1001), null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _comments.EditAsync(_viewer, _sharedId, _item1, mine.Id, "bell\a", null));
        Assert.Equal(1000, (await _comments.EditAsync(_viewer, _sharedId, _item1, mine.Id, new string('a', 1000), null)).Body.Length);
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

    // ---------- threads: replies ----------

    [Fact]
    public async Task AReplyToATopLevelComment_HangsUnderIt_AndOnlyTopLevelCommentsAreInTheMainPage()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);

        var reply = await _comments.CreateAsync(_viewer, _sharedId, _item1, "a reply", null, top.Id);

        Assert.Equal(top.Id, reply.RootCommentId);
        Assert.Equal(top.Id, reply.ParentCommentId);
        Assert.Null(reply.ReplyTo); // a direct reply is already under its parent - no mention needed
        var page = await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null);
        var shown = Assert.Single(page.Items);
        Assert.Equal(top.Id, shown.Id);
        Assert.Equal(1, shown.ReplyCount);
        Assert.Equal(2, page.TotalCount); // the title counts every live comment, replies included
    }

    [Fact]
    public async Task AReplyToAReply_KeepsTheSameRoot_AndNamesTheAnsweredPersonFromTheStoredParent()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);
        var first = await _comments.CreateAsync(_viewer, _sharedId, _item1, "first reply", null, top.Id);

        var second = await _comments.CreateAsync(_contributor, _sharedId, _item1, "@nobody reply to the reply", null, first.Id);

        Assert.Equal(top.Id, second.RootCommentId); // never a deeper level
        Assert.Equal(first.Id, second.ParentCommentId);
        Assert.Equal(await JupleIdOfAsync(_viewer), second.ReplyTo!.JupleId); // from the parent's stored author, not from the typed text
        var replies = await _comments.ListRepliesAsync(_owner, _sharedId, _item1, top.Id, null, null, null);
        Assert.Equal([first.Id, second.Id], replies.Items.Select(item => item.Id));
        Assert.All(replies.Items, item => Assert.Equal(top.Id, item.RootCommentId));
        Assert.Equal(2, replies.TotalCount);
        Assert.Null(replies.NextCursor);
    }

    [Fact]
    public async Task AReplyIsRejected_ForAMissingParent_AnotherLinksComment_AndANonMember()
    {
        var onOne = await _comments.CreateAsync(_owner, _sharedId, _item1, "on one", null);
        await _comments.CreateAsync(_owner, _sharedId, _item2, "on two", null);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_viewer, _sharedId, _item2, "wrong link", null, onOne.Id));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_viewer, _sharedId, _item1, "missing", null, 999_999_999));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_outsider, _sharedId, _item1, "not a member", null, onOne.Id));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.ListRepliesAsync(_outsider, _sharedId, _item1, onOne.Id, null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.SetLikeAsync(_outsider, _sharedId, _item1, onOne.Id, true, null));
        Assert.Equal(1, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == _item1));
    }

    [Fact]
    public async Task ReplyPages_WalkForwardWithAStableCursor_NoDuplicateAndNoMissingReply()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);
        var ids = new List<long>();
        for (var index = 0; index < 7; index++)
        {
            ids.Add((await _comments.CreateAsync(index % 2 == 0 ? _viewer : _contributor, _sharedId, _item1, $"reply {index}", null, top.Id)).Id);
        }

        var seen = new List<long>();
        long? cursor = null;
        var pages = 0;
        do
        {
            var page = await _comments.ListRepliesAsync(_owner, _sharedId, _item1, top.Id, cursor, 3, null);
            seen.AddRange(page.Items.Select(item => item.Id));
            Assert.Equal(7, page.TotalCount);
            cursor = page.NextCursor;
            pages++;
        }
        while (cursor is not null);

        Assert.Equal(ids, seen);
        Assert.Equal(3, pages);
        // A reply id (or a missing one) is not a thread.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.ListRepliesAsync(_owner, _sharedId, _item1, ids[0], null, null, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.ListRepliesAsync(_owner, _sharedId, _item1, 999_999_999, null, null, null));
    }

    // ---------- threads: deletion ----------

    [Fact]
    public async Task ACommentWithoutReplies_IsDeletedForGood()
    {
        var top = await _comments.CreateAsync(_contributor, _sharedId, _item1, "alone", null);

        await _comments.DeleteAsync(_contributor, _sharedId, _item1, top.Id, null);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.Id == top.Id));
    }

    [Fact]
    public async Task DeletingACommentThatHasReplies_LeavesAPlaceholder_AndKeepsTheReplies_UntilTheLastReplyGoes()
    {
        var top = await _comments.CreateAsync(_contributor, _sharedId, _item1, "secret opinion", null);
        var reply = await _comments.CreateAsync(_viewer, _sharedId, _item1, "I disagree", null, top.Id);
        await _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, true, null);

        await _comments.DeleteAsync(_contributor, _sharedId, _item1, top.Id, null);

        _db.ChangeTracker.Clear();
        var stored = await _db.CollectionItemComments.AsNoTracking().SingleAsync(entry => entry.Id == top.Id);
        Assert.True(stored.IsTombstone);
        Assert.Equal(string.Empty, stored.Body); // the words are gone
        Assert.Null(stored.UserId); // and so is the person
        Assert.Equal(0, await _db.CollectionItemCommentLikes.CountAsync(like => like.CommentId == top.Id));
        var page = await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null);
        var shown = Assert.Single(page.Items);
        Assert.True(shown.IsDeleted);
        Assert.Equal(string.Empty, shown.Body);
        Assert.Equal(string.Empty, shown.Author.JupleId);
        Assert.Equal(1, shown.ReplyCount);
        Assert.Equal(1, page.TotalCount); // only the live reply counts as a comment
        var replies = await _comments.ListRepliesAsync(_owner, _sharedId, _item1, top.Id, null, null, null);
        Assert.Equal(reply.Id, Assert.Single(replies.Items).Id);

        // Deleting the same one again is a success; a placeholder can be neither answered nor hearted.
        await _comments.DeleteAsync(_contributor, _sharedId, _item1, top.Id, null);
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.CreateAsync(_viewer, _sharedId, _item1, "too late", null, top.Id));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, true, null));

        // The last reply goes: the finished placeholder goes with it - nothing is left behind.
        await _comments.DeleteAsync(_viewer, _sharedId, _item1, reply.Id, null);
        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == _item1));
    }

    [Fact]
    public async Task AChainOfReplies_KeepsItsPlaceholders_AndCleansThemUpFromTheEnd()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);
        var first = await _comments.CreateAsync(_viewer, _sharedId, _item1, "first", null, top.Id);
        var second = await _comments.CreateAsync(_contributor, _sharedId, _item1, "second", null, first.Id);

        await _comments.DeleteAsync(_viewer, _sharedId, _item1, first.Id, null); // answered by the second: a placeholder
        await _comments.DeleteAsync(_owner, _sharedId, _item1, top.Id, null); // answered by the first: a placeholder

        _db.ChangeTracker.Clear();
        Assert.Equal(3, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == _item1));
        var replies = await _comments.ListRepliesAsync(_owner, _sharedId, _item1, top.Id, null, null, null);
        Assert.True(replies.Items[0].IsDeleted);
        Assert.False(replies.Items[1].IsDeleted);
        Assert.Equal(first.Id, replies.Items[1].ParentCommentId); // the thread keeps its shape

        await _comments.DeleteAsync(_contributor, _sharedId, _item1, second.Id, null);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == _item1));
    }

    [Fact]
    public async Task OnlyTheAuthorOrTheOwnerMayDeleteAReply()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);
        var reply = await _comments.CreateAsync(_viewer, _sharedId, _item1, "reply", null, top.Id);

        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _comments.DeleteAsync(_contributor, _sharedId, _item1, reply.Id, null));
        await _comments.DeleteAsync(_owner, _sharedId, _item1, reply.Id, null);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.Id == reply.Id));
    }

    [Fact]
    public async Task TakingTheLinkOut_RemovesAWholeThreadWithItsHearts_InOneStatement()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);
        var first = await _comments.CreateAsync(_viewer, _sharedId, _item1, "first", null, top.Id);
        await _comments.CreateAsync(_contributor, _sharedId, _item1, "second", null, first.Id);
        await _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, true, null);
        var keep = await _comments.CreateAsync(_owner, _sharedId, _item2, "stays", null);
        await _comments.CreateAsync(_viewer, _sharedId, _item2, "stays too", null, keep.Id);

        await _collections.RemoveAsync(_owner, _sharedId, _item1);

        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == _item1));
        Assert.Equal(0, await _db.CollectionItemCommentLikes.CountAsync(like => like.CommentId == top.Id));
        Assert.Equal(2, await _db.CollectionItemComments.CountAsync(entry => entry.ItemId == _item2));
        // And the whole Item / Collection, threads included.
        await _db.Items.Where(item => item.Id == _item2).ExecuteDeleteAsync();
        await _db.Collections.Where(collection => collection.Id == _sharedId).ExecuteDeleteAsync();
        _db.ChangeTracker.Clear();
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task DeletingAnAccount_KeepsOthersReplies_AsPlaceholdersAndForgottenReplyTargets()
    {
        var top = await _comments.CreateAsync(_contributor, _sharedId, _item1, "mine, answered", null);
        var answer = await _comments.CreateAsync(_viewer, _sharedId, _item1, "answering the contributor", null, top.Id);
        var alone = await _comments.CreateAsync(_contributor, _sharedId, _item1, "mine, alone", null);
        var mineReply = await _comments.CreateAsync(_contributor, _sharedId, _item1, "mine, a reply nobody answers", null, answer.Id);
        await _comments.SetLikeAsync(_contributor, _sharedId, _item1, answer.Id, true, null);
        await _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, true, null);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_contributor, $"test/{_contributor}/", DateTimeOffset.UtcNow);

        _db.ChangeTracker.Clear();
        _userIds.Remove(_contributor);
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.Id == alone.Id)); // unanswered: gone
        Assert.Equal(0, await _db.CollectionItemComments.CountAsync(entry => entry.Id == mineReply.Id));
        var placeholder = await _db.CollectionItemComments.AsNoTracking().SingleAsync(entry => entry.Id == top.Id);
        Assert.True(placeholder.IsTombstone); // answered by somebody else: the thread stays
        Assert.Null(placeholder.UserId);
        var kept = await _db.CollectionItemComments.AsNoTracking().SingleAsync(entry => entry.Id == answer.Id);
        Assert.Null(kept.ReplyToUserId); // it no longer says whom it answered
        Assert.Equal(0, await _db.CollectionItemCommentLikes.CountAsync(like => like.UserId == _contributor));
        Assert.Equal(0, await _db.CollectionItemCommentLikes.CountAsync(like => like.CommentId == top.Id));
        Assert.Equal(0, await _db.Users.CountAsync(user => user.Id == _contributor));
    }

    // ---------- threads: hearts ----------

    [Fact]
    public async Task AHeart_IsIdempotent_CountsEveryPerson_AndCanBeTakenBack()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);

        var liked = await _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, true, null);
        var again = await _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, true, null);
        var other = await _comments.SetLikeAsync(_contributor, _sharedId, _item1, top.Id, true, null);

        Assert.Equal(new CommentLikeStateDto(true, 1), liked);
        Assert.Equal(new CommentLikeStateDto(true, 1), again); // a double tap or a retry is not a second heart
        Assert.Equal(new CommentLikeStateDto(true, 2), other);
        var asViewer = (await _comments.ListAsync(_viewer, _sharedId, _item1, null, null, null)).Items[0];
        var asOwner = (await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null)).Items[0];
        Assert.Equal((2, true), (asViewer.LikeCount, asViewer.ViewerLiked));
        Assert.Equal((2, false), (asOwner.LikeCount, asOwner.ViewerLiked));

        var taken = await _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, false, null);
        var takenAgain = await _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, false, null);

        Assert.Equal(new CommentLikeStateDto(false, 1), taken);
        Assert.Equal(new CommentLikeStateDto(false, 1), takenAgain);
        _db.ChangeTracker.Clear();
        Assert.Equal(1, await _db.CollectionItemCommentLikes.CountAsync(like => like.CommentId == top.Id));
    }

    [Fact]
    public async Task ManyParallelHearts_FromOnePerson_LeaveExactlyOneRow_AndNobodyGetsAnError()
    {
        var top = await _comments.CreateAsync(_owner, _sharedId, _item1, "top", null);

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            await using var context = NewContext();
            var service = new CollectionItemCommentService(
                new CollectionAccessService(new CollectionAccessStore(context), _tokens, TimeProvider.System),
                new CollectionItemCommentStore(context, _photos),
                TimeProvider.System);
            return await service.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, true, null);
        }));

        Assert.All(results, state => Assert.True(state.Liked));
        Assert.All(results, state => Assert.Equal(1, state.LikeCount));
        _db.ChangeTracker.Clear();
        Assert.Equal(1, await _db.CollectionItemCommentLikes.CountAsync(like => like.CommentId == top.Id && like.UserId == _viewer));
    }

    [Fact]
    public async Task AHeartOnAnotherLinksComment_ThroughThisLink_IsNotFound()
    {
        var onTwo = await _comments.CreateAsync(_owner, _sharedId, _item2, "on two", null);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.SetLikeAsync(_viewer, _sharedId, _item1, onTwo.Id, true, null));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _comments.SetLikeAsync(_viewer, _sharedId, _item1, 999_999_999, true, null));
    }

    [Fact]
    public async Task ACommentWrittenByAnOlderApiRevision_IsAnOrdinaryTopLevelComment()
    {
        // The previous revision's INSERT does not know the thread columns.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionItemComments (CollectionId, ItemId, UserId, Body, CreatedAtUtc) VALUES ({_sharedId}, {_item1}, {_viewer}, {"from before replies existed"}, SYSDATETIMEOFFSET())");

        var page = await _comments.ListAsync(_owner, _sharedId, _item1, null, null, null);

        var comment = Assert.Single(page.Items);
        Assert.Equal("from before replies existed", comment.Body);
        Assert.Null(comment.RootCommentId);
        Assert.Equal((0, 0, false, false), (comment.ReplyCount, comment.LikeCount, comment.ViewerLiked, comment.IsDeleted));
        var reply = await _comments.CreateAsync(_owner, _sharedId, _item1, "now it can be answered", null, comment.Id);
        Assert.Equal(comment.Id, reply.RootCommentId);
    }

    [Fact]
    public async Task APageOfThreadedComments_StillLoadsInAFixedNumberOfStatements()
    {
        for (var index = 0; index < 30; index++)
        {
            var top = await _comments.CreateAsync(index % 2 == 0 ? _viewer : _owner, _sharedId, _item1, $"comment {index}", null);
            var reply = await _comments.CreateAsync(_contributor, _sharedId, _item1, $"reply {index}", null, top.Id);
            await _comments.CreateAsync(_viewer, _sharedId, _item1, $"reply to reply {index}", null, reply.Id);
            await _comments.SetLikeAsync(_viewer, _sharedId, _item1, top.Id, true, null);
        }

        var commands = new CommandCounter();
        await using var counted = NewContext(commands);
        var service = new CollectionItemCommentService(
            new CollectionAccessService(new CollectionAccessStore(counted), _tokens, TimeProvider.System),
            new CollectionItemCommentStore(counted, new FakeProfileImageStorage()),
            TimeProvider.System);
        commands.Reset();

        var page = await service.ListAsync(_owner, _sharedId, _item1, null, 30, null);
        var pageStatements = commands.Count;
        commands.Reset();
        var replies = await service.ListRepliesAsync(_owner, _sharedId, _item1, page.Items[0].Id, null, 30, null);
        var replyStatements = commands.Count;

        Assert.Equal(30, page.Items.Count);
        Assert.All(page.Items, item => Assert.Equal((2, 1), (item.ReplyCount, item.LikeCount)));
        Assert.Equal(2, replies.Items.Count);
        Assert.NotNull(replies.Items[1].ReplyTo);
        // 30 comments with replies and hearts cost the same few statements as an empty page - never one per comment.
        Assert.InRange(pageStatements, 1, 12);
        Assert.InRange(replyStatements, 1, 14);
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
