using Juple.Domain.Collections;
using Juple.Domain.Users;

namespace Juple.UnitTests.Collections;

public sealed class CollectionCollaborationDomainTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 26, 0, 0, 0, TimeSpan.Zero);

    // ---------- Juple ID ----------

    [Fact]
    public void JupleId_IsEightCharsFromTheUnambiguousAlphabet()
    {
        for (var i = 0; i < 500; i++)
        {
            var code = UserPublicCode.Generate();
            Assert.Equal(UserPublicCode.Length, code.Length);
            Assert.All(code, character => Assert.Contains(character, UserPublicCode.Alphabet));
            Assert.DoesNotContain(code, character => character is '0' or 'O' or '1' or 'I' or 'L');
        }
    }

    [Fact]
    public void JupleId_IsRandom_NotSequentialOrRepeated()
    {
        var codes = Enumerable.Range(0, 2000).Select(_ => UserPublicCode.Generate()).ToHashSet();
        Assert.Equal(2000, codes.Count);
    }

    [Fact]
    public void JupleId_IsAssignedToEveryNewUser_AndUnrelatedToTheInternalId()
    {
        var first = new User("en-US", "UTC", null, Now, Now);
        var second = new User("en-US", "UTC", null, Now, Now);

        Assert.NotEqual(first.PublicCode, second.PublicCode);
        Assert.True(UserPublicCode.TryNormalize(first.PublicCode, out _));
    }

    [Theory]
    [InlineData("k7mp4q8n", "K7MP4Q8N")]
    [InlineData("K7MP-4Q8N", "K7MP4Q8N")]
    [InlineData("  k7mp 4q8n ", "K7MP4Q8N")]
    public void JupleId_Normalization_IsCaseAndSeparatorInsensitive(string input, string expected)
    {
        Assert.True(UserPublicCode.TryNormalize(input, out var code));
        Assert.Equal(expected, code);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("K7MP4Q8")]      // too short
    [InlineData("K7MP4Q8N2")]    // too long
    [InlineData("K7MP4Q80")]     // '0' is not in the alphabet
    [InlineData("K7MP4QIN")]     // 'I' is not in the alphabet
    [InlineData("K7MP%Q8N")]
    [InlineData("user@example.com")]
    public void JupleId_Normalization_RejectsAnythingThatCannotBeAnId(string? input)
    {
        Assert.False(UserPublicCode.TryNormalize(input, out _));
    }

    // ---------- lock ----------

    [Fact]
    public void Lock_CreatesNoPasswordOfItsOwn_AndEveryChangeBumpsLockVersion()
    {
        var collection = new Collection(1, "A", "A", CollectionIcon.Folder, Now);
        Assert.False(collection.IsLocked);

        collection.Lock(Now);
        Assert.True(collection.IsLocked);
        Assert.Null(collection.LockPasswordHash);
        Assert.Equal(1, collection.LockVersion);

        collection.Lock(Now.AddMinutes(1)); // no-op when already locked
        Assert.Equal(1, collection.LockVersion);

        collection.RemoveLock(Now.AddMinutes(2));
        Assert.False(collection.IsLocked);
        Assert.Equal(2, collection.LockVersion);

        collection.RemoveLock(Now.AddMinutes(3)); // no-op when not locked
        Assert.Equal(2, collection.LockVersion);
    }

    [Fact]
    public void LockPasswordSettings_ReplaceKeepsCreation_AndTheChangeThrottleCountsAWindow()
    {
        var settings = new UserCollectionLockSettings(7, "hash-1", Now);
        for (var i = 0; i < CollectionUnlockThrottle.MaxFailures; i++)
        {
            Assert.Null(settings.ChangeBlockedUntil(Now));
            settings.RecordFailedChange(Now);
        }

        Assert.Equal(Now + CollectionUnlockThrottle.Window, settings.ChangeBlockedUntil(Now.AddMinutes(1)));
        Assert.Null(settings.ChangeBlockedUntil(Now + CollectionUnlockThrottle.Window));

        settings.ReplacePassword("hash-2", Now.AddMinutes(1));
        Assert.Equal("hash-2", settings.PasswordHash);
        Assert.Equal(Now, settings.CreatedAtUtc);
        Assert.Equal(Now.AddMinutes(1), settings.PasswordChangedAtUtc);
        Assert.Equal(0, settings.FailedChangeAttemptCount);
        Assert.Null(settings.ChangeBlockedUntil(Now.AddMinutes(1)));
    }

    // ---------- role changes ----------

    [Fact]
    public void Roles_CanBeSwitched_OnAMember_AndOnlyOnAStillPendingInvitation()
    {
        var member = new CollectionCollaborator(10, 2, CollectionCollaboratorRole.Viewer, 1, Now);
        member.ChangeRole(CollectionCollaboratorRole.Contributor);
        Assert.Equal(CollectionCollaboratorRole.Contributor, member.Role);

        var invitation = new CollectionInvitation(10, 3, 1, CollectionCollaboratorRole.Contributor, Now);
        invitation.ChangeRole(CollectionCollaboratorRole.Viewer, Now.AddMinutes(1));
        Assert.Equal(CollectionCollaboratorRole.Viewer, invitation.Role);

        Assert.Throws<InvalidOperationException>(() =>
            invitation.ChangeRole(CollectionCollaboratorRole.Contributor, Now + CollectionInvitation.Lifetime));
        invitation.Accept(Now.AddMinutes(2));
        Assert.Throws<InvalidOperationException>(() => invitation.ChangeRole(CollectionCollaboratorRole.Contributor, Now.AddMinutes(3)));
    }

    // ---------- invitation ----------

    [Fact]
    public void Invitation_IsPendingUntilExpiry_AndResolvesOnlyOnce()
    {
        var invitation = new CollectionInvitation(1, 2, 3, CollectionCollaboratorRole.Contributor, Now);

        Assert.True(invitation.IsPendingAt(Now.AddDays(13)));
        Assert.False(invitation.IsPendingAt(Now + CollectionInvitation.Lifetime));

        invitation.Accept(Now.AddMinutes(5));
        Assert.Equal(CollectionInvitationStatus.Accepted, invitation.Status);
        Assert.False(invitation.IsPendingAt(Now.AddMinutes(6)));
        Assert.Throws<InvalidOperationException>(() => invitation.Revoke(Now.AddMinutes(7)));
    }

    // ---------- unlock throttle ----------

    [Fact]
    public void Throttle_BlocksAfterMaxFailures_UntilTheWindowEnds()
    {
        var throttle = new CollectionUnlockThrottle(1, "u:9", Now);
        for (var i = 0; i < CollectionUnlockThrottle.MaxFailures - 1; i++)
        {
            throttle.RecordFailure(Now.AddSeconds(i));
            Assert.Null(throttle.BlockedUntil(Now.AddSeconds(i)));
        }

        throttle.RecordFailure(Now.AddSeconds(10));
        Assert.Equal(Now + CollectionUnlockThrottle.Window, throttle.BlockedUntil(Now.AddMinutes(1)));
        Assert.Null(throttle.BlockedUntil(Now + CollectionUnlockThrottle.Window));

        // A failure after the window starts a fresh window.
        throttle.RecordFailure(Now + CollectionUnlockThrottle.Window + TimeSpan.FromSeconds(1));
        Assert.Equal(1, throttle.FailedAttemptCount);
    }
}
