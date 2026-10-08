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

        // Null only on a tombstone (a deleted comment that others answered): see CollectionItemComment.
        builder.Property(comment => comment.UserId).HasColumnType("bigint");

        // Plain text, at most 1000 characters (see CollectionCommentBody); empty only on a tombstone.
        builder.Property(comment => comment.Body)
            .HasColumnType("nvarchar(1000)")
            .HasMaxLength(1000)
            .IsRequired();

        builder.Property(comment => comment.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        // One-level threads: the top-level comment a reply hangs under, the exact comment it answers,
        // and the answered person. All null for a top-level comment (every comment that existed before
        // replies did), so the migration needs no backfill.
        builder.Property(comment => comment.RootCommentId).HasColumnType("bigint");
        builder.Property(comment => comment.ParentCommentId).HasColumnType("bigint");
        builder.Property(comment => comment.ReplyToUserId).HasColumnType("bigint");
        builder.Property(comment => comment.DeletedAtUtc).HasColumnType("datetimeoffset");
        builder.Ignore(comment => comment.IsTombstone);

        // A link's conversation, in creation order: the page query (newest N before an id) and the count
        // both read exactly this key range. Id is the creation order and the paging cursor.
        builder.HasIndex(comment => new { comment.CollectionId, comment.ItemId, comment.Id })
            .HasDatabaseName("IX_CollectionItemComments_CollectionId_ItemId_Id");

        // "This person's comments" - the account deletion.
        builder.HasIndex(comment => comment.UserId)
            .HasDatabaseName("IX_CollectionItemComments_UserId");

        // A thread's replies in creation order (the reply pages and the reply counts) - replies only.
        builder.HasIndex(comment => new { comment.RootCommentId, comment.Id })
            .HasDatabaseName("IX_CollectionItemComments_RootCommentId_Id")
            .HasFilter("[RootCommentId] IS NOT NULL");

        // "Is anything answering this comment" (delete vs. tombstone) and the FK's own lookups.
        builder.HasIndex(comment => comment.ParentCommentId)
            .HasDatabaseName("IX_CollectionItemComments_ParentCommentId")
            .HasFilter("[ParentCommentId] IS NOT NULL");

        // "Replies to this person" - the account deletion clears them.
        builder.HasIndex(comment => comment.ReplyToUserId)
            .HasDatabaseName("IX_CollectionItemComments_ReplyToUserId")
            .HasFilter("[ReplyToUserId] IS NOT NULL");

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

        // The answered person: NoAction too - AccountDeletionStore clears it (the reply itself stays).
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(comment => comment.ReplyToUserId)
            .OnDelete(DeleteBehavior.NoAction);

        // A thread never loses a reply because its parent went: NoAction, and the store tombstones a
        // comment that is still answered instead of deleting it. When the whole link's conversation
        // goes (the membership cascade above) every row goes in the same statement, which NoAction allows.
        builder.HasOne<CollectionItemComment>()
            .WithMany()
            .HasForeignKey(comment => comment.RootCommentId)
            .OnDelete(DeleteBehavior.NoAction);

        builder.HasOne<CollectionItemComment>()
            .WithMany()
            .HasForeignKey(comment => comment.ParentCommentId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
