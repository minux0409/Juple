using Juple.Domain.Items;
using Juple.Domain.Purchases;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Purchases;

public sealed class RepeatPurchaseConfiguration : IEntityTypeConfiguration<RepeatPurchase>
{
    public void Configure(EntityTypeBuilder<RepeatPurchase> builder)
    {
        // Same schema as Purchases, not a dedicated "Repeat Purchases" schema - mirrors
        // ItemSaveRequestConfiguration reusing the "items" schema for a closely related entity
        // rather than every docs/architecture.md module boundary getting its own physical schema.
        builder.ToTable("RepeatPurchases", "purchases", table =>
        {
            table.HasCheckConstraint("CK_RepeatPurchases_IntervalValue_Positive", "[IntervalValue] > 0");
            // IntervalUnit is a byte enum (Day=0, Week=1, Month=2) - this blocks any value outside
            // the currently-defined range at the database level, not just via the .NET enum type.
            table.HasCheckConstraint("CK_RepeatPurchases_IntervalUnit_Valid", "[IntervalUnit] IN (0, 1, 2)");
            table.HasCheckConstraint(
                "CK_RepeatPurchases_ReminderLeadDays_NonNegative", "[ReminderLeadDays] >= 0");
            // Mirrors CK_Purchases_ProductName_NotWhitespaceOnly exactly - see PurchaseConfiguration.
            table.HasCheckConstraint(
                "CK_RepeatPurchases_ProductName_NotWhitespaceOnly",
                "PATINDEX('%[^' + CHAR(9) + CHAR(10) + CHAR(13) + ' ]%', [ProductName]) > 0");
        });

        builder.HasKey(repeatPurchase => repeatPurchase.Id);
        builder.Property(repeatPurchase => repeatPurchase.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(repeatPurchase => repeatPurchase.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.ItemId)
            .HasColumnType("bigint");

        builder.Property(repeatPurchase => repeatPurchase.ProductName)
            .HasColumnType("nvarchar(500)")
            .HasMaxLength(500)
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.IntervalValue)
            .HasColumnType("int")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.IntervalUnit)
            .HasColumnType("tinyint")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.NextPurchaseDate)
            .HasColumnType("date")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.IsReminderEnabled)
            .HasColumnType("bit")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.ReminderLeadDays)
            .HasColumnType("int")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.IsEnabled)
            .HasColumnType("bit")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.UpdatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(repeatPurchase => repeatPurchase.RowVersion)
            .IsRowVersion()
            .IsConcurrencyToken();

        // Upcoming-schedule list for a user - the primary RepeatPurchase query pattern.
        builder.HasIndex(repeatPurchase => new
            {
                repeatPurchase.UserId,
                repeatPurchase.IsEnabled,
                repeatPurchase.NextPurchaseDate,
                repeatPurchase.Id,
            })
            .HasDatabaseName("IX_RepeatPurchases_UserId_IsEnabled_NextPurchaseDate_Id");

        // SQL Server does not auto-index FK columns; an Item-scoped RepeatPurchase lookup ("does
        // this Item have a repeat setting") mirrors IX_Purchases_ItemId's identical justification.
        builder.HasIndex(repeatPurchase => repeatPurchase.ItemId)
            .HasDatabaseName("IX_RepeatPurchases_ItemId");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(repeatPurchase => repeatPurchase.UserId)
            .OnDelete(DeleteBehavior.NoAction);

        // Deleting an Item must never delete its RepeatPurchase settings - only detach the
        // reference, mirroring Purchase.ItemId's identical SET NULL behavior.
        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(repeatPurchase => repeatPurchase.ItemId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
