using Juple.Domain.Categories;

namespace Juple.UnitTests.Categories;

public sealed class CategoryTests
{
    [Fact]
    public void Constructor_SetsNameAndSortOrder()
    {
        var category = new Category(17, "Groceries", 3);

        Assert.Equal("Groceries", category.Name);
        Assert.Equal(3, category.SortOrder);
    }

    [Fact]
    public void Rename_ChangesName()
    {
        var category = new Category(17, "Groceries", 0);

        category.Rename("Food");

        Assert.Equal("Food", category.Name);
    }

    [Fact]
    public void Rename_WithSameValue_IsNoOp()
    {
        var category = new Category(17, "Groceries", 0);

        category.Rename("Groceries");

        Assert.Equal("Groceries", category.Name);
    }
}
