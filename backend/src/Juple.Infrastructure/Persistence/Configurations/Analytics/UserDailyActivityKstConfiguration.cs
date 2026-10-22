using Juple.Domain.Analytics;
using Juple.Domain.Users;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Juple.Infrastructure.Persistence.Configurations.Analytics;

public sealed class UserDailyActivityKstConfiguration : IEntityTypeConfiguration<UserDailyActivityKst>
{
    public void Configure(EntityTypeBuilder<UserDailyActivityKst> b)
    {
        b.ToTable("UserDailyActivitiesKst", "analytics");
        b.HasKey(x => x.Id);
        b.Property(x => x.Id).UseIdentityColumn();
        b.Property(x => x.Date).HasColumnType("date");
        b.Property(x => x.Platform).HasConversion<string>().HasMaxLength(16);
        b.HasIndex(x => new { x.UserId, x.Date, x.Platform }).IsUnique();
        b.HasIndex(x => x.Date).IncludeProperties(x => new { x.UserId, x.Platform });
        b.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
