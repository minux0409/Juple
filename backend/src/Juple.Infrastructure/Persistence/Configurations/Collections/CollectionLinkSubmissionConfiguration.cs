using Juple.Domain.Collections;
using Juple.Domain.Items;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionLinkSubmissionConfiguration : IEntityTypeConfiguration<CollectionLinkSubmission>
{
    public void Configure(EntityTypeBuilder<CollectionLinkSubmission> builder)
    {
        builder.ToTable("CollectionLinkSubmissions", "collections");

        builder.HasKey(submission => submission.Id);
        builder.Property(submission => submission.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(submission => submission.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(submission => submission.ItemId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(submission => submission.SubmittedByUserId)
            .HasColumnType("bigint")
            .IsRequired();

        builder.Property(submission => submission.ViaPublicShare)
            .HasColumnType("bit")
            .IsRequired();

        // Same column types/limits as Item's own Url/Title/PreviewImageUrl - a snapshot of them.
        builder.Property(submission => submission.Url)
            .HasColumnType("nvarchar(max)")
            .HasMaxLength(4096)
            .IsRequired();

        builder.Property(submission => submission.UrlHash)
            .HasColumnType("binary(32)")
            .IsRequired();

        builder.Property(submission => submission.Title)
            .HasColumnType("nvarchar(500)")
            .HasMaxLength(500);

        builder.Property(submission => submission.PreviewImageUrl)
            .HasColumnType("nvarchar(max)")
            .HasMaxLength(4096);

        builder.Property(submission => submission.CreatedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // One pending proposal per link per Collection - a database rule, so two people (or two taps)
        // proposing the same link at once cannot both get in. Also serves the Owner's count.
        builder.HasIndex(submission => new { submission.CollectionId, submission.UrlHash })
            .IsUnique()
            .HasDatabaseName("UX_CollectionLinkSubmissions_CollectionId_UrlHash");

        // The Owner's list: oldest first, keyset-paged by Id.
        builder.HasIndex(submission => new { submission.CollectionId, submission.Id })
            .HasDatabaseName("IX_CollectionLinkSubmissions_CollectionId_Id");

        builder.HasIndex(submission => submission.ItemId)
            .HasDatabaseName("IX_CollectionLinkSubmissions_ItemId");

        builder.HasIndex(submission => submission.SubmittedByUserId)
            .HasDatabaseName("IX_CollectionLinkSubmissions_SubmittedByUserId");

        // Like CollectionItems: meaningless without its Collection or its Item - both cascade (the
        // Item's own deletion, or the Collection's, removes the proposal with it). The proposer's
        // UserId is NoAction like every other UserId FK - AccountDeletionStore clears these explicitly.
        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(submission => submission.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<Item>()
            .WithMany()
            .HasForeignKey(submission => submission.ItemId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(submission => submission.SubmittedByUserId)
            .OnDelete(DeleteBehavior.NoAction);
    }
}
