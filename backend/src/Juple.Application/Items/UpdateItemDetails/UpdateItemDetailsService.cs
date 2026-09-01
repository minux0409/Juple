namespace Juple.Application.Items.UpdateItemDetails;

public sealed class UpdateItemDetailsService(IItemDetailsStore itemDetailsStore) : IUpdateItemDetailsService
{
    public Task UpdateAsync(
        long userId,
        long itemId,
        UpdateItemDetailsCommand command,
        CancellationToken cancellationToken = default)
    {
        var title = NormalizeTitle(command.Title);
        var memo = NormalizeMemo(command.Memo);

        return itemDetailsStore.UpdateDetailsAsync(userId, itemId, title, memo, cancellationToken);
    }

    // Title is a display name: outer whitespace carries no meaning, so it is trimmed. A
    // whitespace-only value has no display value either, so it collapses to null.
    private static string? NormalizeTitle(string? title)
    {
        var trimmedTitle = title?.Trim();
        if (string.IsNullOrEmpty(trimmedTitle))
        {
            return null;
        }

        if (trimmedTitle.Length > 500)
        {
            throw new InvalidItemDetailsException("title", "Title must be 500 characters or fewer.");
        }

        return trimmedTitle;
    }

    // Memo is free user text: line breaks and internal/outer whitespace are preserved verbatim.
    // Only a genuinely empty value (null or "") collapses to null - a whitespace-only Memo is a
    // deliberate user entry and is kept as-is.
    private static string? NormalizeMemo(string? memo)
    {
        if (string.IsNullOrEmpty(memo))
        {
            return null;
        }

        if (memo.Length > 4000)
        {
            throw new InvalidItemDetailsException("memo", "Memo must be 4000 characters or fewer.");
        }

        return memo;
    }
}
