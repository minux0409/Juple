using Juple.Application.Users.Profile;
using Juple.Domain.Users;

namespace Juple.UnitTests.Users;

public sealed class UserDisplayNameTests
{
    [Theory]
    [InlineData("피카츄", "피카츄")]
    [InlineData("  Pikachu  ", "Pikachu")]
    [InlineData("ピカチュウ ⚡", "ピカチュウ ⚡")]
    [InlineData("👨‍👩‍👧 family", "👨‍👩‍👧 family")] // ZWJ sequence stays intact
    [InlineData("مرحبا", "مرحبا")]
    public void Accepts_AnyScriptAndEmoji_TrimmedOnly(string input, string expected)
    {
        Assert.True(UserDisplayName.TryNormalize(input, out var name, out var error));
        Assert.Equal(expected, name);
        Assert.Null(error);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
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
    [InlineData("zero\u200Bwidth")]
    public void Rejects_ControlSeparatorAndInvisibleFormattingCharacters(string input)
    {
        Assert.False(UserDisplayName.TryNormalize(input, out var name, out var error));
        Assert.Null(name);
        Assert.NotNull(error);
    }

    [Fact]
    public void MaxLength_CountsUserPerceivedCharacters()
    {
        Assert.True(UserDisplayName.TryNormalize(new string('가', 30), out _, out _));
        Assert.False(UserDisplayName.TryNormalize(new string('가', 31), out _, out _));
        // 30 emoji are 60 UTF-16 units but still 30 characters.
        Assert.True(UserDisplayName.TryNormalize(string.Concat(Enumerable.Repeat("😀", 30)), out _, out _));
        Assert.False(UserDisplayName.TryNormalize(string.Concat(Enumerable.Repeat("😀", 31)), out _, out _));
    }

    private const string Family = "\U0001F468\u200D\U0001F469\u200D\U0001F467"; // ZWJ sequence, 8 UTF-16 units

    private static string Repeat(string value, int count) => string.Concat(Enumerable.Repeat(value, count));

    /// <summary>One letter with <paramref name="marks"/> combining acute accents: a single text element.</summary>
    private static string Stacked(int marks) => "e" + new string('\u0301', marks);

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
        // Exactly the column size (512 UTF-16 units) in 30 text elements: accepted - storable.
        var atCap = string.Concat(Enumerable.Repeat(Stacked(16), 29)) + Stacked(18);
        Assert.Equal(UserDisplayName.MaxStorageLength, atCap.Length);
        Assert.True(UserDisplayName.TryNormalize(atCap, out _, out _));

        // One unit over, still 30 text elements: rejected by validation, never by the database.
        Assert.False(UserDisplayName.TryNormalize(atCap + "\u0301", out _, out var error));
        Assert.NotNull(error);

        // A single pathological text element far beyond the cap.
        Assert.False(UserDisplayName.TryNormalize(Stacked(600), out _, out _));
    }

    [Fact]
    public async Task ProfileService_StoresTheNormalizedName_AndRejectsInvalidInputWithoutStoring()
    {
        var store = new FakeProfileStore();
        var service = new UserProfileService(store, TimeProvider.System);

        var profile = await service.SetDisplayNameAsync(7, "  피카츄 ");
        Assert.Equal(new UserProfileDto("피카츄", "K7MP4Q8N"), profile);

        await Assert.ThrowsAsync<InvalidDisplayNameException>(() => service.SetDisplayNameAsync(7, "a\nb"));
        Assert.Equal("피카츄", store.Name);

        Assert.Equal(new UserProfileDto(null, "K7MP4Q8N"), await service.SetDisplayNameAsync(7, "   "));
    }

    private sealed class FakeProfileStore : IUserProfileStore
    {
        public string? Name { get; private set; }

        public Task<UserProfileDto?> GetAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<UserProfileDto?>(new UserProfileDto(Name, "K7MP4Q8N"));

        public Task<UserProfileDto> SetDisplayNameAsync(long userId, string? displayName, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default)
        {
            Name = displayName;
            return Task.FromResult(new UserProfileDto(Name, "K7MP4Q8N"));
        }
    }
}
