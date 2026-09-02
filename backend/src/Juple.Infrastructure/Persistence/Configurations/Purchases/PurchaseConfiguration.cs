using Juple.Domain.Items;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Purchases;

public sealed class PurchaseConfiguration : IEntityTypeConfiguration<Purchase>
{
    public void Configure(EntityTypeBuilder<Purchase> builder)
    {
        builder.ToTable("Purchases", "purchases", table =>
        {
            // A free/discounted-to-zero purchase is a legitimate record; a negative Amount is not.
            table.HasCheckConstraint("CK_Purchases_Amount_NonNegative", "[Amount] >= 0");
            table.HasCheckConstraint("CK_Purchases_Quantity_Positive", "[Quantity] > 0");
            // Amount and CurrencyCode are one unit (see database-conventions.md) - never store one
            // without the other, even though both are individually optional on this Entity.
            table.HasCheckConstraint(
                "CK_Purchases_Amount_CurrencyCode_Together",
                "([Amount] IS NULL AND [CurrencyCode] IS NULL) OR ([Amount] IS NOT NULL AND [CurrencyCode] IS NOT NULL)");
            // NOT NULL alone would still admit a whitespace-only value - this is the structural
            // guarantee that ProductName always identifies something, independent of whether an
            // Application-layer normalizer exists yet. LTRIM/RTRIM alone only strip spaces (not
            // tab/newline/carriage-return), so this uses PATINDEX to require at least one
            // character outside that whitespace set instead (verified against a real SQL Server
            // instance, not assumed).
            table.HasCheckConstraint(
                "CK_Purchases_ProductName_NotWhitespaceOnly",
                "PATINDEX('%[^' + CHAR(9) + CHAR(10) + CHAR(13) + ' ]%', [ProductName]) > 0");
        });

        builder.HasKey(purchase => purchase.Id);
        builder.Property(purchase => purchase.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(purchase => purchase.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(purchase => purchase.ItemId)
            .HasColumnType("bigint");

        builder.Property(purchase => purchase.PurchaseDate)
            .HasColumnType("date")
            .IsRequired();

        builder.Property(purchase => purchase.ProductName)
            .HasColumnType("nvarchar(500)")
            .HasMaxLength(500)
            .IsRequired();

        builder.Property(purchase => purchase.Amount)
            .HasColumnType("decimal(19,4)");

        builder.Property(purchase => purchase.CurrencyCode)
            .HasColumnType("char(3)")
            .IsUnicode(false);

        builder.Property(purchase => purchase.Store)
            .HasColumnType("nvarchar(200)")
            .HasMaxLength(200);

        builder.Property(purchase => purchase.Variant)
            .HasColumnType("nvarchar(200)")
            .HasMaxLength(200);

        builder.Property(purchase => purchase.Quantity)
            .HasColumnType("decimal(18,3)");

        builder.Property(purchase => purchase.Memo)
            .HasColumnType("nvarchar(4000)")
            .HasMaxLength(4000);

        builder.Property(purchase => purchase.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // History-latest-first lookup for a user - the primary Purchase History query pattern.
        builder.HasIndex(purchase => new { purchase.UserId, purchase.PurchaseDate, purchase.Id })
            .HasDatabaseName("IX_Purchases_UserId_PurchaseDate_Id");

        // SQL Server does not auto-index FK columns; an Item-scoped purchase history lookup
        // ("past purchases of this Item") is a directly stated product query pattern.
        builder.HasIndex(purchase => purchase.ItemId)
            .HasDatabaseName("IX_Purchases_ItemId");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(purchase => purchase.UserId)
            .OnDelete(DeleteBehavior.NoAction);

        // Deleting an Item must never delete the Purchase history that references it - only detach
        // the reference (SET NULL never removes a row, unlike a cascade crossing the
        // Items/Purchases module boundary would - see ItemConfiguration.CategoryId for the same
        // pattern applied to Items/Categories).
        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(purchase => purchase.ItemId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
