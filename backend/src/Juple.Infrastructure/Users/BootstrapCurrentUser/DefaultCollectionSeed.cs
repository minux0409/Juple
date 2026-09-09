namespace Juple.Infrastructure.Users.BootstrapCurrentUser;

/// <summary>
/// Default Collections seeded once for every newly-provisioned User (see
/// CurrentUserProvisioningStore.CreateOrGetAsync) - plain Collection.Name values like any
/// user-typed name, not i18n keys or a translation layer. Names are picked once at seed time from
/// the new user's PreferredLocale and never re-translated afterward; the seeded Collections are
/// then ordinary, fully renamable/deletable rows with no "system category" flag.
/// </summary>
internal static class DefaultCollectionSeed
{
    private static readonly string[] NamesKo = ["위시리스트", "음식", "영화", "애니"];
    private static readonly string[] NamesEn = ["Wishlist", "Food", "Movies", "Anime"];

    internal static IReadOnlyList<string> NamesFor(string preferredLocale) =>
        preferredLocale.StartsWith("en", StringComparison.OrdinalIgnoreCase) ? NamesEn : NamesKo;
}
