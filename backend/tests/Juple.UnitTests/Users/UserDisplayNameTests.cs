using Juple.Application.Users.Profile;
using Juple.Domain.Users;

namespace Juple.UnitTests.Users;

public sealed class UserDisplayNameTests
{
    [Theory]
    [InlineData("피카츄", "피카츄")]
    [InlineData("  Pikachu  ", "Pikachu")]
    [InlineData("ピカチュウ ⚡", "ピカチュウ ⚡")]
    [InlineData("皮卡丘", "皮卡丘")]
    [InlineData("Zoë Ångström", "Zoë Ångström")]
    [InlineData("Nguyễn Thị Hà", "Nguyễn Thị Hà")]
    [InlineData("สมชาย", "สมชาย")]
    [InlineData("👨\u200D👩\u200D👧 family", "👨\u200D👩\u200D👧 family")] // ZWJ sequence stays intact
    [InlineData("🏳️\u200D🌈", "🏳️\u200D🌈")] // variation selectors + ZWJ
    [InlineData("1️⃣ first", "1️⃣ first")] // keycap: VS16 + enclosing keycap
    [InlineData("🏴\U000E0067\U000E0062\U000E0065\U000E006E\U000E0067\U000E007F", "🏴\U000E0067\U000E0062\U000E0065\U000E006E\U000E0067\U000E007F")] // England flag tag sequence
    [InlineData("山田\u3000太郎", "山田\u3000太郎")] // ideographic space
    [InlineData("مرحبا", "مرحبا")]
    public void Accepts_AnyScriptAndEmoji_TrimmedOnly(string input, string expected)
    {
        Assert.True(UserDisplayName.TryNormalize(input, out var name, out var error));
        Assert.Equal(expected, name);
        Assert.Null(error);
    }

    [Fact]
    public void NormalizesToNfc_SoTheSameLookingNameIsTheSameText()
    {
        // "é" typed as e + combining acute (NFD) is stored as the single precomposed letter.
        Assert.True(UserDisplayName.TryNormalize("Cafe\u0301", out var name, out _));
        Assert.Equal("Caf\u00E9", name);
        // Hangul typed as conjoining jamo becomes the syllable.
        Assert.True(UserDisplayName.TryNormalize("\u1112\u1161\u11AB", out var hangul, out _));
        Assert.Equal("한", hangul);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\u3000 ")]
    public void EmptyOrWhitespace_ClearsTheName(string? input)
    {
        Assert.True(UserDisplayName.TryNormalize(input, out var name, out _));
        Assert.Null(name);
    }

    [Theory]
    [InlineData("line\nbreak")]
    [InlineData("tab\there")]
    [InlineData("bell\u0007")]
    [InlineData("sep\u2028arator")]
    [InlineData("rtl\u202Eoverride")]
    [InlineData("isolate\u2066x\u2069")]
    [InlineData("mark\u200Fx")]
    [InlineData("zero\u200Bwidth")]
    [InlineData("word\u2060joiner")]
    [InlineData("bom\uFEFFx")]
    [InlineData("soft\u00ADhyphen")]
    [InlineData("nbsp\u00A0name")]
    [InlineData("thin\u2009space")]
    [InlineData("\u3164")] // Hangul filler alone - looks empty
    [InlineData("a\u3164b")]
    [InlineData("\u115F\u1160")]
    [InlineData("\u2800")] // braille blank
    [InlineData("cgj\u034Fx")]
    [InlineData("private\uE000use")]
    [InlineData("tag\U000E0041outside a flag")]
    [InlineData("musical\U0001D173format")] // astral format character
    public void Rejects_ControlSeparatorInvisibleAndSpoofingCharacters(string input)
    {
        Assert.False(UserDisplayName.TryNormalize(input, out var name, out var error));
        Assert.Null(name);
        Assert.Equal(UserDisplayNameError.InvalidCharacters, error);
    }

    [Fact]
    public void Rejects_UnpairedSurrogates()
    {
        Assert.False(UserDisplayName.TryNormalize("bad\uD800x", out _, out var error));
        Assert.Equal(UserDisplayNameError.InvalidCharacters, error);
    }

    [Fact]
    public void CombiningMarks_AFewPerCharacterAreFine_ZalgoIsNot()
    {
        Assert.True(UserDisplayName.TryNormalize(Stacked(UserDisplayName.MaxCombiningMarksPerTextElement), out _, out _));
        Assert.False(UserDisplayName.TryNormalize(Stacked(UserDisplayName.MaxCombiningMarksPerTextElement + 1), out _, out var error));
        Assert.Equal(UserDisplayNameError.InvalidCharacters, error);
    }

    [Fact]
    public void MaxLength_CountsUserPerceivedCharacters()
    {
        Assert.True(UserDisplayName.TryNormalize(new string('가', 30), out _, out _));
        Assert.False(UserDisplayName.TryNormalize(new string('가', 31), out _, out var error));
        Assert.Equal(UserDisplayNameError.TooLong, error);
        // 30 emoji are 60 UTF-16 units but still 30 characters.
        Assert.True(UserDisplayName.TryNormalize(string.Concat(Enumerable.Repeat("😀", 30)), out _, out _));
        Assert.False(UserDisplayName.TryNormalize(string.Concat(Enumerable.Repeat("😀", 31)), out _, out _));
    }

    private const string Family = "\U0001F468\u200D\U0001F469\u200D\U0001F467"; // ZWJ sequence, 8 UTF-16 units

    private static string Repeat(string value, int count) => string.Concat(Enumerable.Repeat(value, count));

    /// <summary>
    /// One letter with <paramref name="marks"/> combining overlines: a single text element. A mark
    /// with no precomposed form, so NFC cannot fold any of them into the letter.
    /// </summary>
    private static string Stacked(int marks) => "x" + new string('\u0305', marks);

    /// <summary>One text element of <paramref name="emoji"/> smileys joined by ZWJ (3 UTF-16 units each).</summary>
    internal static string ZwjChain(int emoji) => string.Join("\u200D", Enumerable.Repeat("\U0001F600", emoji));

    [Fact]
    public void Accepts_30Hangul_30Emoji_And30ZwjEmojiSequences()
    {
        Assert.True(UserDisplayName.TryNormalize(Repeat("가", 30), out _, out _));
        Assert.True(UserDisplayName.TryNormalize(Repeat("\U0001F600", 30), out _, out _));
        var families = Repeat(Family, 30);
        Assert.Equal(240, families.Length);
        Assert.True(UserDisplayName.TryNormalize(families, out var name, out _));
        Assert.Equal(families, name);
        Assert.False(UserDisplayName.TryNormalize(Repeat(Family, 31), out _, out _));
    }

    [Fact]
    public void TechnicalStorageCap_IsEnforcedHere_EvenWithin30TextElements()
    {
        // Exactly the column size (512 UTF-16 units: 170 emoji + 169 ZWJ = 509, + 3 letters) in 4
        // text elements: accepted - storable.
        var atCap = ZwjChain(170) + "abc";
        Assert.Equal(UserDisplayName.MaxStorageLength, atCap.Length);
        Assert.True(UserDisplayName.TryNormalize(atCap, out _, out _));

        // One unit over, still well within 30 text elements: rejected by validation, never by the database.
        Assert.False(UserDisplayName.TryNormalize(atCap + "d", out _, out var error));
        Assert.Equal(UserDisplayNameError.TooLong, error);
    }

    [Fact]
    public async Task ProfileService_StoresTheNormalizedName_AndRejectsInvalidInputWithoutStoring()
    {
        var store = new FakeProfileStore();
        var service = new UserProfileService(store, TimeProvider.System);

        var profile = await service.SetDisplayNameAsync(7, "  피카츄 ");
        Assert.Equal(new UserProfileDto("피카츄", "K7MP4Q8N"), profile);

        var rejected = await Assert.ThrowsAsync<InvalidDisplayNameException>(() => service.SetDisplayNameAsync(7, "a\nb"));
        Assert.Equal(NicknameErrorCodes.InvalidCharacters, rejected.Code);
        Assert.Equal("피카츄", store.Name);

        Assert.Equal(new UserProfileDto(null, "K7MP4Q8N"), await service.SetDisplayNameAsync(7, "   "));
    }

    internal sealed class FakeProfileStore : IUserProfileStore
    {
        public string? Name { get; set; }

        public string? BlobName { get; set; }

        public bool FailNextImageWrite { get; set; }

        public Task<UserProfileRecord?> GetAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<UserProfileRecord?>(new UserProfileRecord(Name, "K7MP4Q8N", BlobName));

        public Task<UserProfileRecord> SetDisplayNameAsync(long userId, string? displayName, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default)
        {
            Name = displayName;
            return Task.FromResult(new UserProfileRecord(Name, "K7MP4Q8N", BlobName));
        }

        public Task<(UserProfileRecord Profile, string? ReplacedBlobName)> SetProfileImageAsync(
            long userId, string? blobName, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default)
        {
            if (FailNextImageWrite)
            {
                FailNextImageWrite = false;
                throw new InvalidOperationException("Simulated database failure.");
            }

            var previous = BlobName == blobName ? null : BlobName;
            BlobName = blobName;
            return Task.FromResult((new UserProfileRecord(Name, "K7MP4Q8N", BlobName), previous));
        }
    }
}
