using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.UnitTests.Persistence.SqlServer;

public sealed class SqlServerUniqueConstraintViolationDetectorTests
{
    [Theory]
    [InlineData(2601)]
    [InlineData(2627)]
    public void IsUniqueConstraintViolation_WhenUniqueConstraintErrorNumber_ReturnsTrue(int errorNumber)
    {
        Assert.True(SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(errorNumber));
    }

    [Fact]
    public void IsUniqueConstraintViolation_WhenOtherSqlServerErrorNumber_ReturnsFalse()
    {
        Assert.False(SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(50000));
    }

    [Fact]
    public void IsUniqueConstraintViolation_WhenInnerExceptionIsNotSqlException_ReturnsFalse()
    {
        var exception = new DbUpdateException("Unexpected failure.", new InvalidOperationException());

        Assert.False(SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception));
    }
}
