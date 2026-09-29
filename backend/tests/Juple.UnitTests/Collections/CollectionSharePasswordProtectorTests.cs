using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Collections;

/// <summary>The reversible copy of a share password: authenticated, bound to its Collection, fail-closed.</summary>
public sealed class CollectionSharePasswordProtectorTests
{
    private static readonly string KeyA = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    private static readonly string KeyB = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

    private static CollectionSharePasswordProtector Create(string key, byte keyId = 1) =>
        new(Options.Create(new CollectionSharePasswordOptions { EncryptionKey = key, KeyId = keyId }));

    [Fact]
    public void ItRoundTrips_AndTheSealedFormIsNeverThePassword()
    {
        var protector = Create(KeyA);

        var sealedPassword = protector.Protect(10, "공유 비번 1234");

        Assert.DoesNotContain("1234", sealedPassword, StringComparison.Ordinal);
        Assert.Equal("공유 비번 1234", protector.Unprotect(10, sealedPassword));
        // A fresh random nonce every time: the same password never seals to the same text.
        Assert.NotEqual(sealedPassword, protector.Protect(10, "공유 비번 1234"));
    }

    [Fact]
    public void AnyTampering_FailsClosed()
    {
        var protector = Create(KeyA);
        var sealedPassword = protector.Protect(10, "open-sesame");
        var bytes = sealedPassword.ToCharArray();
        var index = bytes.Length / 2;
        bytes[index] = bytes[index] == 'A' ? 'B' : 'A';

        Assert.Null(protector.Unprotect(10, new string(bytes)));
        Assert.Null(protector.Unprotect(10, sealedPassword[..^4]));
        Assert.Null(protector.Unprotect(10, "not-an-envelope"));
        Assert.Null(protector.Unprotect(10, string.Empty));
    }

    [Fact]
    public void AnotherKey_AnotherKeyId_OrAnotherCollection_FailsClosed()
    {
        var sealedPassword = Create(KeyA).Protect(10, "open-sesame");

        Assert.Null(Create(KeyB).Unprotect(10, sealedPassword));
        Assert.Null(Create(KeyA, keyId: 2).Unprotect(10, sealedPassword));
        Assert.Null(Create(KeyA).Unprotect(11, sealedPassword));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not base64 !!")]
    [InlineData("AAAA")]
    public void AMissingOrMalformedKey_StopsItFromBeingCreated(string key)
    {
        Assert.Throws<InvalidOperationException>(() => Create(key));
    }
}
