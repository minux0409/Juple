using Juple.Domain.Collections;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Collections;

public sealed class CollectionUnlockThrottleConfiguration : IEntityTypeConfiguration<CollectionUnlockThrottle>
{
    public void Configure(EntityTypeBuilder<CollectionUnlockThrottle> builder)
    {
        builder.ToTable("CollectionUnlockThrottles", "collections");

        builder.HasKey(throttle => throttle.Id);
        builder.Property(throttle => throttle.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(throttle => throttle.CollectionId)
            .HasColumnType("bigint")
            .IsRequired();

        // "u:{userId}" or "p:{shareId}" - internal keys, never shown to anyone.
        builder.Property(throttle => throttle.SubjectKey)
            .HasColumnType("varchar(64)")
            .HasMaxLength(64)
            .IsUnicode(false)
            .IsRequired();

        builder.Property(throttle => throttle.FailedAttemptCount)
            .HasColumnType("int")
            .IsRequired();

        builder.Property(throttle => throttle.WindowStartedAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.HasIndex(throttle => new { throttle.CollectionId, throttle.SubjectKey })
            .IsUnique()
            .HasDatabaseName("UX_CollectionUnlockThrottles_CollectionId_SubjectKey");

        builder.HasOne<Collection>()
            .WithMany()
            .HasForeignKey(throttle => throttle.CollectionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
