using Juple.Domain.Analytics;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Analytics;

public sealed class UserDailyActivityConfiguration : IEntityTypeConfiguration<UserDailyActivity>
{
    public void Configure(EntityTypeBuilder<UserDailyActivity> builder)
    {
        builder.ToTable("UserDailyActivities", "analytics", table =>
        {
            // Stored by name, so appending a platform never changes what an existing row means.
            table.HasCheckConstraint("CK_UserDailyActivities_Platform_Valid", "[Platform] IN ('Unknown', 'Android', 'Ios', 'Web')");
            table.HasCheckConstraint("CK_UserDailyActivities_SeenOrder", "[LastSeenAtUtc] >= [FirstSeenAtUtc]");
        });

        builder.HasKey(activity => activity.Id);
        builder.Property(activity => activity.Id)
            .ValueGeneratedOnAdd()
            .UseIdentityColumn();

        builder.Property(activity => activity.UserId)
            .IsRequired();

        builder.Property(activity => activity.ActivityDateUtc)
            .HasColumnType("date")
            .IsRequired();

        builder.Property(activity => activity.Platform)
            .HasConversion<string>()
            .HasColumnType("nvarchar(16)")
            .HasMaxLength(16)
            .IsRequired();

        builder.Property(activity => activity.AppBuild)
            .HasMaxLength(32);

        builder.Property(activity => activity.FirstSeenAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        builder.Property(activity => activity.LastSeenAtUtc)
            .HasColumnType("datetimeoffset")
            .IsRequired();

        // The business invariant (one row per person, UTC day and platform) and the upsert's key - concurrent first requests
        // converge on one row instead of duplicating it.
        builder.HasIndex(activity => new { activity.UserId, activity.ActivityDateUtc, activity.Platform })
            .IsUnique()
            .HasDatabaseName("UX_UserDailyActivities_User_Date_Platform");

        // The analytics queries: a date range, then distinct users per day / platform - answered from this index alone.
        builder.HasIndex(activity => activity.ActivityDateUtc)
            .IncludeProperties(activity => new { activity.UserId, activity.Platform })
            .HasDatabaseName("IX_UserDailyActivities_ActivityDateUtc");

        // Activity is the person's own data: deleting the account deletes it (docs/analytics.md, docs/data-retention.md).
        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(activity => activity.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
