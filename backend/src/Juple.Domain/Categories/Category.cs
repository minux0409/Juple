namespace Juple.Domain.Categories;

public sealed class Category
{
    private Category()
    {
    }

    public Category(long userId, string name, int sortOrder)
    {
        UserId = userId;
        Name = name;
        SortOrder = sortOrder;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public string Name { get; private set; } = null!;

    public int SortOrder { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    /// <summary>Callers must pass an already-normalized (trimmed, non-empty) value.</summary>
    public void Rename(string name)
    {
        if (Name == name)
        {
            return;
        }

        Name = name;
    }
}
