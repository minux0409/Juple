using System.Text;
using Juple.Application.Users.Profile;

namespace Juple.UnitTests.Users;

public sealed class NicknamePolicyTests
{
    [Theory]
    [InlineData("피카츄")]
    [InlineData("Pikachu")]
    [InlineData("ピカチュウ")]
    [InlineData("皮卡丘")]
    [InlineData("Zoë")]
    [InlineData("🌻")]
    [InlineData("^^")]
    [InlineData("민")] // one character is a whole name in Korean/Chinese - no minimum beyond "not empty"
    public void OrdinaryNames_AreValid(string input)
    {
        Assert.Equal(NicknameVerdict.Valid, NicknamePolicy.Evaluate(input, out var normalized));
        Assert.Equal(input, normalized);
    }

    [Theory]
    [InlineData("Juple")]
    [InlineData("juple")]
    [InlineData("JUPLE")]
    [InlineData("J U P L E")]
    [InlineData("juple.official")]
    [InlineData("Juple Support")]
    [InlineData("Juple_Admin")]
    [InlineData("ＪＵＰＬＥ")] // full-width
    [InlineData("Júple")] // accent dropped for matching
    [InlineData("I love juple")]
    [InlineData("쥬플")]
    [InlineData("쥬플 공식")]
    [InlineData("Admin")]
    [InlineData("ADMINISTRATOR")]
    [InlineData("a.d.m.i.n")]
    [InlineData("Official")]
    [InlineData("Support")]
    [InlineData("System")]
    [InlineData("관리자")]
    [InlineData("운영자")]
    [InlineData("고객센터")]
    [InlineData("管理者")]
    [InlineData("管理员")]
    [InlineData("官方")]
    [InlineData("Administrador")]
    public void ReservedNames_AndObviousVariants_AreReserved(string input)
    {
        Assert.Equal(NicknameVerdict.Reserved, NicknamePolicy.Evaluate(input, out var normalized));
        Assert.Null(normalized);
    }

    [Theory]
    [InlineData("fuck")]
    [InlineData("F.U.C.K you")]
    [InlineData("bitchplease")]
    [InlineData("ass")]
    [InlineData("A S S")]
    [InlineData("씨발")]
    [InlineData("씨발놈아")]
    [InlineData("병신")]
    [InlineData("개새끼")]
    [InlineData("시발")]
    [InlineData("ㅅㅂ")]
    public void ObviousAbuse_IsProhibited(string input)
    {
        Assert.Equal(NicknameVerdict.Prohibited, NicknamePolicy.Evaluate(input, out var normalized));
        Assert.Null(normalized);
    }

    /// <summary>Exact-only terms that appear inside ordinary words and names - never blocked by containment.</summary>
    [Theory]
    [InlineData("Cassandra")] // ass
    [InlineData("Grasshopper")] // ass
    [InlineData("Scunthorpe")] // cunt
    [InlineData("Dickens")] // dick
    [InlineData("Essex")] // sex
    [InlineData("therapist")] // rapist, rape
    [InlineData("Shiitake")]
    [InlineData("Pornchai")] // porn (Thai given name)
    [InlineData("Cockburn")] // cock
    [InlineData("시발점")] // 시발 - "starting point"
    [InlineData("시발역")]
    [InlineData("보지 마")] // 보지 - "don't look"
    [InlineData("자지 마")] // 자지 - "don't sleep"
    [InlineData("새끼손가락")] // 새끼 - "little finger"
    [InlineData("Systema")] // system is exact
    [InlineData("Supporter")] // support is exact
    [InlineData("Official Pikachu fan")] // official is exact
    [InlineData("관리자님팬")] // 관리자 is exact
    public void FalsePositives_OrdinaryWordsContainingShortTerms_AreValid(string input)
    {
        Assert.Equal(NicknameVerdict.Valid, NicknamePolicy.Evaluate(input, out _));
    }

    [Fact]
    public void CharacterRules_ComeFirst_AndMapToTheirOwnVerdicts()
    {
        Assert.Equal(NicknameVerdict.InvalidCharacters, NicknamePolicy.Evaluate("ju\u200Bple", out _));
        Assert.Equal(NicknameVerdict.TooLong, NicknamePolicy.Evaluate(new string('가', 31), out _));
        Assert.Equal(NicknameVerdict.Valid, NicknamePolicy.Evaluate("   ", out var cleared));
        Assert.Null(cleared);
    }

    [Fact]
    public void ErrorCodes_AreStable()
    {
        Assert.Equal("nicknameTooLong", NicknameErrorCodes.For(NicknameVerdict.TooLong));
        Assert.Equal("nicknameInvalidCharacters", NicknameErrorCodes.For(NicknameVerdict.InvalidCharacters));
        Assert.Equal("nicknameReserved", NicknameErrorCodes.For(NicknameVerdict.Reserved));
        Assert.Equal("nicknameProhibited", NicknameErrorCodes.For(NicknameVerdict.Prohibited));
    }

    [Fact]
    public void MatchKey_DropsSpacingPunctuationCaseAndAccents()
    {
        Assert.Equal("juple", NicknameMatchKey.From(" J.u-P_l E! "));
        Assert.Equal("juple", NicknameMatchKey.From("ＪＵＰＬＥ"));
        Assert.Equal("쥬플", NicknameMatchKey.From("쥬 플"));
        Assert.Equal(string.Empty, NicknameMatchKey.From("🌻 ^^"));
    }

    [Fact]
    public void EmbeddedTermList_Loads()
    {
        var list = NicknameTermList.LoadEmbedded();
        Assert.True(list.Reserved.Matches("juple"));
        Assert.True(list.Prohibited.Matches("fuck"));
    }

    [Fact]
    public void TermList_RejectsATermWithNothingToMatch()
    {
        const string json = """{ "reserved": { "exact": ["!!!"], "contains": [] }, "prohibited": { "exact": [], "contains": [] } }""";
        Assert.Throws<InvalidOperationException>(() => NicknameTermList.Parse(new MemoryStream(Encoding.UTF8.GetBytes(json))));
    }

    [Fact]
    public async Task ProfileService_AppliesThePolicy_SoTheApiCannotBypassIt()
    {
        var store = new UserDisplayNameTests.FakeProfileStore { Name = "피카츄" };
        var service = new UserProfileService(store, TimeProvider.System);

        var reserved = await Assert.ThrowsAsync<InvalidDisplayNameException>(() => service.SetDisplayNameAsync(7, "Juple Official"));
        Assert.Equal(NicknameErrorCodes.Reserved, reserved.Code);
        var prohibited = await Assert.ThrowsAsync<InvalidDisplayNameException>(() => service.SetDisplayNameAsync(7, "씨발"));
        Assert.Equal(NicknameErrorCodes.Prohibited, prohibited.Code);
        Assert.Equal("피카츄", store.Name);
    }

    [Fact]
    public async Task ExistingNickname_ThatFailsTheNewPolicy_IsStillReturnedUnchanged()
    {
        // Stored before the policy existed: reading the profile never re-validates or rewrites it.
        var store = new UserDisplayNameTests.FakeProfileStore { Name = "Juple" };
        var service = new UserProfileService(store, TimeProvider.System);

        Assert.Equal("Juple", (await service.GetAsync(7)).DisplayName);
        Assert.Equal("Juple", store.Name);

        // ...and the next change meets the policy.
        await Assert.ThrowsAsync<InvalidDisplayNameException>(() => service.SetDisplayNameAsync(7, "Juple"));
        Assert.Equal("피카츄", (await service.SetDisplayNameAsync(7, "피카츄")).DisplayName);
    }
}
