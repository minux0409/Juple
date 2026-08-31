using Juple.Domain.Inbox;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Inbox;

public sealed class InboxEntryConfiguration : IEntityTypeConfiguration<InboxEntry>
{
    public void Configure(EntityTypeBuilder<InboxEntry> builder)
    {
        builder.ToTable("InboxEntries", "inbox", table =>
            table.HasCheckConstraint(
                "CK_InboxEntries_Url_MaxLength",
                "DATALENGTH([Url]) <= 8192"));

        builder.HasKey(entry => entry.Id);
        builder.Property(entry => entry.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(entry => entry.UserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(entry => entry.Url)
            .HasColumnType("nvarchar(max)")
            .HasMaxLength(4096)
            .IsRequired();

        builder.Property(entry => entry.ClientRequestId)
            .HasColumnType("uniqueidentifier");

        builder.Property(entry => entry.SavedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.HasIndex(entry => new { entry.UserId, entry.SavedAtUtc, entry.Id })
            .HasDatabaseName("IX_InboxEntries_UserId_SavedAtUtc_Id");

        builder.HasIndex(entry => new { entry.UserId, entry.ClientRequestId })
            .IsUnique()
            .HasDatabaseName("UX_InboxEntries_UserId_ClientRequestId")
            .HasFilter("[ClientRequestId] IS NOT NULL");

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(entry => entry.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}