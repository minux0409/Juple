using Juple.Api.Controllers.Admin;
using Juple.Application.Admin;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Juple.UnitTests.Safety;

/// <summary>공유 제한 was retired: the two admin routes still exist only to answer clearly that it is gone.</summary>
public sealed class ShareRestrictionRetiredTests
{
    [Fact]
    public void CreatingOrLiftingAShareRestriction_IsRefusedAsGone_WithAClearCode()
    {
        var controller = new AdminReportsController(new AdminReportService(null!, TimeProvider.System));

        foreach (var result in new[] { Assert.IsType<ObjectResult>(controller.RestrictRetired(7)), Assert.IsType<ObjectResult>(controller.LiftRestrictionRetired(7)) })
        {
            Assert.Equal(StatusCodes.Status410Gone, result.StatusCode);
            var problem = Assert.IsType<ProblemDetails>(result.Value);
            Assert.Equal("shareRestrictionRetired", problem.Extensions["code"]);
        }
    }

    [Fact]
    public void BothRetiredRoutesAreStillMapped_SoAnOldAdminClientGetsTheClearAnswer()
    {
        var templates = new[] { nameof(AdminReportsController.RestrictRetired), nameof(AdminReportsController.LiftRestrictionRetired) }
            .Select(name => typeof(AdminReportsController).GetMethod(name)!.GetCustomAttributes(typeof(HttpPostAttribute), inherit: false).Cast<HttpPostAttribute>().Single().Template)
            .ToList();

        Assert.Contains("{reportId:long}/restriction", templates);
        Assert.Contains("{reportId:long}/restriction/lift", templates);
    }
}
