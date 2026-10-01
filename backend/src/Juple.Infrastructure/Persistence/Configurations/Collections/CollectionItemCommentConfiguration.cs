using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionItemCommentConfiguration : IEntityTypeConfiguration<CollectionItemComment>
{
    public void Configure(EntityTypeBuilder<CollectionItemComment> builder)
    {
        builder.ToTable("CollectionItemComments", "collections");

        builder.HasKey(comment => comment.Id);
        builder.Property(comment => comment.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(comment => comment.CollectionId).HasColumnType("bigint").IsRequired();
        builder.Property(comment => comment.ItemId).HasColumnType("bigint").IsRequired();
        builder.Property(comment => comment.UserId).HasColumnType("bigint").IsRequired();

        // Plain text, at most 1000 characters (see CollectionCommentBody).
        builder.Property(comment => comment.Body)
            .HasColumnType("nvarchar(1000)")
            .HasMaxLength(1000)
            .IsRequired();

        builder.Property(comment => comment.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        // A link's conversation, in creation order: the page query (newest N before an id) and the count
        // both read exactly this key range. Id is the creation order and the paging cursor.
        builder.HasIndex(comment => new { comment.CollectionId, comment.ItemId, comment.Id })
            .HasDatabaseName("IX_CollectionItemComments_CollectionId_ItemId_Id");

        // "This person's comments" - the account deletion.
        builder.HasIndex(comment => comment.UserId)
            .HasDatabaseName("IX_CollectionItemComments_UserId");

        // The conversation belongs to the link's membership (a CollectionItem) and goes with it - through
        // the one cascade path CollectionItems already has (see CollectionItemReactionConfiguration).
        builder.HasOne<CollectionItem>()
            .WithMany()
            .HasForeignKey(comment => new { comment.CollectionId, comment.ItemId })
            .HasPrincipalKey(membership => new { membership.CollectionId, membership.ItemId })
            .OnDelete(DeleteBehavior.Cascade);

        // The author: NoAction like every other UserId FK - AccountDeletionStore clears these.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(comment => comment.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
