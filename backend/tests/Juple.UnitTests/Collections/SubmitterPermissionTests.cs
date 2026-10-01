using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Public;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

/// <summary>
/// 승인 후 추가 as the middle of three levels - 읽기 전용 &lt; 승인 후 추가 &lt; 링크 추가 - for specific
/// people (roles) and for the public link (permissions) alike, without changing a single existing
/// stored or wire value.
/// </summary>
public sealed class SubmitterPermissionTests
{
    [Fact]
    public void ExistingValues_KeepTheirMeaning_TheNewOnesAreAppended()
    {
        // Stored by name - and the existing names/order are untouched.
        Assert.Equal(["Contributor", "Viewer", "Submitter"], Enum.GetNames<CollectionCollaboratorRole>());
        Assert.Equal(["Read", "Write", "Submit"], Enum.GetNames<CollectionSharePermission>());
        // "Submit" fits the varchar(10) CollectionShares.Permission column; "Submitter" the varchar(20) role columns.
        Assert.True(nameof(CollectionSharePermission.Submit).Length <= 10);
        Assert.True(nameof(CollectionCollaboratorRole.Submitter).Length <= 20);

        Assert.Equal("viewer", CollectionDtoAccessRoles.ForCollaborator(CollectionCollaboratorRole.Viewer));
        Assert.Equal("contributor", CollectionDtoAccessRoles.ForCollaborator(CollectionCollaboratorRole.Contributor));
        Assert.Equal("submitter", CollectionDtoAccessRoles.ForCollaborator(CollectionCollaboratorRole.Submitter));
        Assert.Equal("read", PublicSharePermissions.ToWire(CollectionSharePermission.Read));
        Assert.Equal("write", PublicSharePermissions.ToWire(CollectionSharePermission.Write));
        Assert.Equal("submit", PublicSharePermissions.ToWire(CollectionSharePermission.Submit));
        Assert.True(PublicSharePermissions.TryParse("Submit", out var parsed));
        Assert.Equal(CollectionSharePermission.Submit, parsed);
    }

    [Theory]
    [InlineData(CollectionSharePermission.Read, CollectionCollaboratorRole.Viewer, true)]
    [InlineData(CollectionSharePermission.Read, CollectionCollaboratorRole.Submitter, true)]
    [InlineData(CollectionSharePermission.Read, CollectionCollaboratorRole.Contributor, true)]
    [InlineData(CollectionSharePermission.Submit, CollectionCollaboratorRole.Viewer, false)]
    [InlineData(CollectionSharePermission.Submit, CollectionCollaboratorRole.Submitter, true)]
    [InlineData(CollectionSharePermission.Submit, CollectionCollaboratorRole.Contributor, true)]
    [InlineData(CollectionSharePermission.Write, CollectionCollaboratorRole.Viewer, false)]
    [InlineData(CollectionSharePermission.Write, CollectionCollaboratorRole.Submitter, false)]
    [InlineData(CollectionSharePermission.Write, CollectionCollaboratorRole.Contributor, true)]
    public void ThePublicLink_IsTheMinimum_AtThreeLevels(CollectionSharePermission link, CollectionCollaboratorRole role, bool allowed)
    {
        Assert.Equal(allowed, PublicShareRoles.Allows(link, role));
    }

    [Fact]
    public void TheRolesBelowEachLevel()
    {
        Assert.Empty(PublicShareRoles.RolesBelow(CollectionSharePermission.Read));
        Assert.Equal([CollectionCollaboratorRole.Viewer], PublicShareRoles.RolesBelow(CollectionSharePermission.Submit));
        Assert.Equal(
            [CollectionCollaboratorRole.Viewer, CollectionCollaboratorRole.Submitter],
            PublicShareRoles.RolesBelow(CollectionSharePermission.Write).Order());
        Assert.Equal(CollectionCollaboratorRole.Submitter, PublicShareRoles.MinimumFor(CollectionSharePermission.Submit));
    }

    [Fact]
    public void ASubmitter_Views_KeepsTheirFavorite_AndProposes_NothingElse()
    {
        var submitter = new CollectionAccess(1, CollectionAccessRole.Submitter, false, 0);
        Assert.True(submitter.Allows(CollectionPermission.View));
        Assert.True(submitter.Allows(CollectionPermission.Favorite));
        Assert.True(submitter.Allows(CollectionPermission.SubmitLink));
        foreach (var permission in Enum.GetValues<CollectionPermission>().Except([CollectionPermission.View, CollectionPermission.Favorite, CollectionPermission.SubmitLink]))
        {
            Assert.False(submitter.Allows(permission));
        }

        // Only the Owner reviews proposals; nobody but a Submitter proposes (a Contributor adds directly).
        Assert.True(new CollectionAccess(1, CollectionAccessRole.Owner, false, 0).Allows(CollectionPermission.ReviewSubmissions));
        foreach (var role in new[] { CollectionAccessRole.Contributor, CollectionAccessRole.Viewer, CollectionAccessRole.Submitter })
        {
            Assert.False(new CollectionAccess(1, role, false, 0).Allows(CollectionPermission.ReviewSubmissions));
        }

        Assert.False(new CollectionAccess(1, CollectionAccessRole.Viewer, false, 0).Allows(CollectionPermission.SubmitLink));
    }
}
