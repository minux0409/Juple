using Juple.Domain.Collections;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionItemCommentLikeConfiguration : IEntityTypeConfiguration<CollectionItemCommentLike>
{
    public void Configure(EntityTypeBuilder<CollectionItemCommentLike> builder)
    {
        builder.ToTable("CollectionItemCommentLikes", "collections");

        builder.HasKey(like => like.Id);
        builder.Property(like => like.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(like => like.CommentId).HasColumnType("bigint").IsRequired();
        builder.Property(like => like.UserId).HasColumnType("bigint").IsRequired();
        builder.Property(like => like.CreatedAtUtc).HasColumnType("datetimeoffset").IsRequired();

        // One heart per person per comment - a database rule. Its CommentId prefix also serves the
        // per-page like counts, so there is no second index for them.
        builder.HasIndex(like => new { like.CommentId, like.UserId })
            .IsUnique()
            .HasDatabaseName("UX_CollectionItemCommentLikes_CommentId_UserId");

        // "This person's hearts" - the account deletion.
        builder.HasIndex(like => like.UserId)
            .HasDatabaseName("IX_CollectionItemCommentLikes_UserId");

        // The heart goes with its comment (the only cascade path into this table).
        builder.HasOne<CollectionItemComment>()
            .WithMany()
            .HasForeignKey(like => like.CommentId)
            .OnDelete(DeleteBehavior.Cascade);

        // The person: NoAction like every other UserId FK - AccountDeletionStore clears these.
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(like => like.UserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
