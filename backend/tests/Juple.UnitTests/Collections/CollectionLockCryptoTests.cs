using System.Security.Cryptography;
using System.Text;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Locking;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Collections;

public sealed class CollectionLockCryptoTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 26, 0, 0, 0, TimeSpan.Zero);
    private static readonly CollectionUnlockSubject User9 = CollectionUnlockSubject.ForUser(9);

    private static CollectionUnlockTokenProtector Protector(byte[]? key = null) =>
        new(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(key ?? Enumerable.Range(1, 32).Select(i => (byte)i).ToArray()),
        }));

    // ---------- unlock grants ----------

    [Fact]
    public void Grant_IsValidOnlyForItsCollectionSubjectVersion_AndUntilExpiry()
    {
        var protector = Protector();
        var grant = protector.Issue(5, User9, version: 3, Now);

        Assert.Equal(Now + CollectionUnlockTokenProtector.Lifetime, grant.ExpiresAtUtc);
        Assert.True(protector.IsValid(grant.Token, 5, User9, 3, Now));
        Assert.True(protector.IsValid(grant.Token, 5, User9, 3, grant.ExpiresAtUtc.AddSeconds(-1)));

        Assert.False(protector.IsValid(grant.Token, 6, User9, 3, Now));                                  // other Collection
        Assert.False(protector.IsValid(grant.Token, 5, CollectionUnlockSubject.ForUser(10), 3, Now));      // other user
        Assert.False(protector.IsValid(grant.Token, 5, CollectionUnlockSubject.ForPublicShare(9), 3, Now)); // same id, other kind
        Assert.False(protector.IsValid(grant.Token, 5, User9, 4, Now));                                  // lock changed
        Assert.False(protector.IsValid(grant.Token, 5, User9, 3, grant.ExpiresAtUtc));                   // expired
    }

    [Fact]
    public void Grant_IsStateless_AnyInstanceWithTheSameKeyValidatesIt_AndOtherKeysDoNot()
    {
        var grant = Protector().Issue(5, User9, 1, Now);

        Assert.True(Protector().IsValid(grant.Token, 5, User9, 1, Now)); // "another replica"
        Assert.False(Protector(RandomNumberGenerator.GetBytes(32)).IsValid(grant.Token, 5, User9, 1, Now));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-token")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    public void Garbage_IsNeverValid(string? token)
    {
        Assert.False(Protector().IsValid(token, 5, User9, 1, Now));
    }

    [Fact]
    public void TamperedGrant_IsRejected_AndItsPayloadIsNotReadable()
    {
        var token = Protector().Issue(5, User9, 1, Now).Token;
        var tampered = token[..^2] + (token[^2] == 'A' ? "B" : "A") + token[^1];
        Assert.False(Protector().IsValid(tampered, 5, User9, 1, Now));

        // Encrypted, not just signed: the holder cannot read ids or versions out of it.
        var decoded = Convert.FromBase64String(token.Replace('-', '+').Replace('_', '/').PadRight((token.Length + 3) / 4 * 4, '='));
        var asText = Encoding.UTF8.GetString(decoded);
        Assert.DoesNotContain("\"C\"", asText);
        Assert.DoesNotContain("\"S\":9", asText);
    }

    [Fact]
    public void Protector_RefusesToStartWithoutAProperKey()
    {
        Assert.Throws<InvalidOperationException>(() => new CollectionUnlockTokenProtector(
            Options.Create(new CollectionUnlockGrantOptions { EncryptionKey = "" })));
        Assert.Throws<InvalidOperationException>(() => new CollectionUnlockTokenProtector(
            Options.Create(new CollectionUnlockGrantOptions { EncryptionKey = Convert.ToBase64String(new byte[16]) })));
    }

    // ---------- password hashing ----------

    [Fact]
    public void Hash_IsSaltedAndSlow_NeverThePassword_AndVerifiesOnlyTheRightOne()
    {
        var hasher = new CollectionLockPasswordHasher();
        var first = hasher.Hash("correct horse");
        var second = hasher.Hash("correct horse");

        Assert.DoesNotContain("correct horse", first);
        Assert.NotEqual(first, second); // per-hash random salt
        Assert.True(first.Length <= 200); // fits the column
        Assert.True(hasher.Verify(first, "correct horse"));
        Assert.True(hasher.Verify(second, "correct horse"));
        Assert.False(hasher.Verify(first, "correct horse "));
        Assert.False(hasher.Verify(first, "Correct horse"));
        Assert.False(hasher.Verify("not-a-hash", "correct horse"));
    }
}
