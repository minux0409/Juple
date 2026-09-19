using Juple.Domain.Items;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Items;

public sealed class InstagramMetadataRetryTaskConfiguration : IEntityTypeConfiguration<InstagramMetadataRetryTask>
{
    public void Configure(EntityTypeBuilder<InstagramMetadataRetryTask> builder)
    {
        builder.ToTable("InstagramMetadataRetryTasks", "items");

        builder.HasKey(task => task.Id);
        builder.Property(task => task.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(task => task.ItemId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(task => task.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(task => task.AttemptCount)
            .HasColumnType("int")
            .IsRequired();

        builder.Property(task => task.NextAttemptAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(task => task.LastAttemptAtUtc)
            .HasColumnType("datetimeoffset");

        builder.Property(task => task.LastErrorCode)
            .HasColumnType("varchar(100)")
            .IsUnicode(false);

        builder.Property(task => task.ClaimedAtUtc)
            .HasColumnType("datetimeoffset");

        // At most one pending retry task per Item - both the correctness backstop for concurrent
        // discovery (see IInstagramMetadataRetryStore.RegisterNewCandidatesAsync) and the natural
        // lookup path for ListDueAsync's join back to Items.
        builder.HasIndex(task => task.ItemId)
            .IsUnique()
            .HasDatabaseName("IX_InstagramMetadataRetryTasks_ItemId");

        // Worker discovery (ListDueAsync) always filters/orders by this.
        builder.HasIndex(task => task.NextAttemptAtUtc)
            .HasDatabaseName("IX_InstagramMetadataRetryTasks_NextAttemptAtUtc");

        // Real FK with cascade delete, unlike ItemSaveRequest.ItemId - see
        // InstagramMetadataRetryTask's own remarks: this task has no meaning once its Item is gone.
        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(task => task.ItemId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
