using Juple.Application.Collections;
using Juple.Domain.Collections;
using Juple.Application.Collections.Collaboration;

namespace Juple.UnitTests.Collections;

public sealed class CollectionCollaborationServiceTests
{
    private const long Owner = 1;
    private const long Contributor = 2;
    private const long Invitee = 3;
    private const long CollectionId = 10;

    private readonly FakeDirectory _directory = new()
    {
        Codes = { [Owner] = "WNER2345", [Contributor] = "CNTRB234", [Invitee] = "NVTEE234" },
    };

    private readonly RecordingCollaborationStore _store = new();

    private CollectionCollaborationService Service() => new(
        new Juple.Application.Collections.Access.CollectionAccessService(
            new InMemoryCollectionAccessStore().Add(CollectionId, Owner, Contributor), new FakeUnlockTokenProtector(), TimeProvider.System),
        _directory,
        _store,
        TimeProvider.System);

    [Fact]
    public async Task Lookup_IsExact_ReturnsOnlyTheJupleId_AndFlagsSelf()
    {
        Assert.Equal(new JupleIdLookupResult("NVTEE234", false), await Service().LookupAsync(Owner, "nvtee234"));
        Assert.True((await Service().LookupAsync(Owner, "WNER2345")).IsSelf);
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => Service().LookupAsync(Owner, "NVTEE23"));
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => Service().LookupAsync(Owner, "NOBODY22"));
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => Service().LookupAsync(Owner, "someone@example.com"));
    }

    [Fact]
    public async Task Lookup_AlsoReturnsThePersonsOwnDisplayName_AndNothingElse()
    {
        _directory.Names[Invitee] = "피카츄";

        Assert.Equal(new JupleIdLookupResult("NVTEE234", false, "피카츄"), await Service().LookupAsync(Owner, "NVTEE234"));
        Assert.Equal(new JupleIdLookupResult("CNTRB234", false, null), await Service().LookupAsync(Owner, "CNTRB234"));
    }

    [Fact]
    public async Task Participants_AreVisibleToEveryMember_ButPendingInvitationsAndManagementOnlyToTheOwner()
    {
        var ownerView = await Service().GetParticipantsAsync(Owner, CollectionId);
        Assert.True(ownerView.CanManage);
        Assert.Single(ownerView.PendingInvitations);
        Assert.Equal((CollectionId, Owner, true), _store.LastParticipants);

        var contributorView = await Service().GetParticipantsAsync(Contributor, CollectionId);
        Assert.False(contributorView.CanManage);
        Assert.Empty(contributorView.PendingInvitations);
        Assert.Equal(2, contributorView.Participants.Count);
        Assert.Equal((CollectionId, Contributor, false), _store.LastParticipants);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().GetParticipantsAsync(Invitee, CollectionId));
    }

    [Fact]
    public async Task Invite_ResolvesTheJupleIdToTheInternalUser_ButNeverTheCallerThemself()
    {
        await Service().InviteAsync(Owner, CollectionId, "nvte-e234");
        Assert.Equal((CollectionId, Owner, Invitee), _store.LastInvite);
        // No role given: a Contributor, exactly as before Viewer existed.
        Assert.Equal(CollectionCollaboratorRole.Contributor, _store.LastInviteRole);

        var self = await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().InviteAsync(Owner, CollectionId, "WNER2345"));
        Assert.Equal("jupleId", self.Field);
    }

    [Fact]
    public async Task Invite_PassesTheRequestedRole_AndRejectsAnUnknownOne()
    {
        var viewer = await Service().InviteAsync(Owner, CollectionId, "NVTEE234", CollectionCollaboratorRole.Viewer);
        Assert.Equal(CollectionCollaboratorRole.Viewer, _store.LastInviteRole);
        Assert.Equal("Viewer", viewer.Role);

        var unknown = await Assert.ThrowsAsync<InvalidCollectionException>(() =>
            Service().InviteAsync(Owner, CollectionId, "NVTEE234", (CollectionCollaboratorRole)42));
        Assert.Equal("role", unknown.Field);
    }

    [Fact]
    public async Task OnlyTheOwner_ManagesCollaborators()
    {
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().InviteAsync(Contributor, CollectionId, "NVTEE234"));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().GetOverviewAsync(Contributor, CollectionId));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().RemoveCollaboratorAsync(Contributor, CollectionId, "WNER2345"));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().RevokeInvitationAsync(Contributor, CollectionId, 5));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().InviteAsync(Invitee, CollectionId, "CNTRB234"));
        Assert.Null(_store.LastInvite);
    }

    [Fact]
    public async Task RemovingAnUnknownJupleId_IsNotFound()
    {
        await Assert.ThrowsAsync<CollectionCollaboratorNotFoundException>(() => Service().RemoveCollaboratorAsync(Owner, CollectionId, "NOBODY22"));
        await Service().RemoveCollaboratorAsync(Owner, CollectionId, "cntrb234");
        Assert.Equal((CollectionId, Contributor), _store.LastRemoval);
    }

    [Fact]
    public async Task RoleChanges_AreOwnerOnly_ResolveTheJupleId_AndRejectAnUnknownRole()
    {
        await Service().ChangeCollaboratorRoleAsync(Owner, CollectionId, "cntrb-234", CollectionCollaboratorRole.Viewer);
        Assert.Equal((CollectionId, Owner, Contributor, CollectionCollaboratorRole.Viewer), _store.LastCollaboratorRoleChange);
        await Service().ChangeInvitationRoleAsync(Owner, CollectionId, 5, CollectionCollaboratorRole.Contributor);
        Assert.Equal((CollectionId, Owner, 5L, CollectionCollaboratorRole.Contributor), _store.LastInvitationRoleChange);

        await Assert.ThrowsAsync<CollectionCollaboratorNotFoundException>(() =>
            Service().ChangeCollaboratorRoleAsync(Owner, CollectionId, "NOBODY22", CollectionCollaboratorRole.Viewer));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() =>
            Service().ChangeCollaboratorRoleAsync(Contributor, CollectionId, "CNTRB234", CollectionCollaboratorRole.Contributor));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() =>
            Service().ChangeInvitationRoleAsync(Contributor, CollectionId, 5, CollectionCollaboratorRole.Contributor));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() =>
            Service().ChangeInvitationRoleAsync(Invitee, CollectionId, 5, CollectionCollaboratorRole.Contributor));
        var unknown = await Assert.ThrowsAsync<InvalidCollectionException>(() =>
            Service().ChangeInvitationRoleAsync(Owner, CollectionId, 5, (CollectionCollaboratorRole)42));
        Assert.Equal("role", unknown.Field);
    }

    private sealed class FakeDirectory : IUserDirectoryStore
    {
        public Dictionary<long, string> Codes { get; } = [];

        public Task<long?> FindUserIdByPublicCodeAsync(string publicCode, CancellationToken cancellationToken = default) =>
            Task.FromResult(Codes.Where(entry => entry.Value == publicCode).Select(entry => (long?)entry.Key).FirstOrDefault());

        public Task<string?> GetPublicCodeAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Codes.TryGetValue(userId, out var code) ? code : null);

        public Dictionary<long, string> Names { get; } = [];

        public Task<string?> GetDisplayNameAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Names.TryGetValue(userId, out var name) ? name : null);
    }

    private sealed class RecordingCollaborationStore : ICollectionCollaborationStore
    {
        public (long CollectionId, long OwnerId, long InvitedId)? LastInvite { get; private set; }

        public (long CollectionId, long UserId)? LastRemoval { get; private set; }

        public (long CollectionId, long CallerId, bool IncludePending)? LastParticipants { get; private set; }

        public Task<CollectionParticipantsDto> GetParticipantsAsync(
            long collectionId, long callerUserId, bool includePending, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            LastParticipants = (collectionId, callerUserId, includePending);
            IReadOnlyList<CollectionPendingInvitationDto> pending = includePending
                ? [new CollectionPendingInvitationDto(5, "NVTEE234", "Contributor", nowUtc, nowUtc.AddDays(14))]
                : [];
            return Task.FromResult(new CollectionParticipantsDto(
                [new CollectionParticipantDto("WNER2345", "Pika", "owner"), new CollectionParticipantDto("CNTRB234", null, "contributor")],
                pending,
                CanManage: includePending));
        }

        public CollectionCollaboratorRole? LastInviteRole { get; private set; }

        public Task<CollectionPendingInvitationDto> CreateInvitationAsync(long collectionId, long ownerUserId, long invitedUserId, DateTimeOffset nowUtc, CollectionCollaboratorRole role = CollectionCollaboratorRole.Contributor, CancellationToken cancellationToken = default)
        {
            LastInvite = (collectionId, ownerUserId, invitedUserId);
            LastInviteRole = role;
            return Task.FromResult(new CollectionPendingInvitationDto(1, "NVTEE234", role.ToString(), nowUtc, nowUtc.AddDays(14)));
        }

        public Task RevokeInvitationAsync(long collectionId, long invitationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public (long CollectionId, long OwnerId, long InvitationId, CollectionCollaboratorRole Role)? LastInvitationRoleChange { get; private set; }

        public (long CollectionId, long OwnerId, long UserId, CollectionCollaboratorRole Role)? LastCollaboratorRoleChange { get; private set; }

        public Task ChangeInvitationRoleAsync(long collectionId, long ownerUserId, long invitationId, CollectionCollaboratorRole role, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            LastInvitationRoleChange = (collectionId, ownerUserId, invitationId, role);
            return Task.CompletedTask;
        }

        public Task ChangeCollaboratorRoleAsync(long collectionId, long ownerUserId, long collaboratorUserId, CollectionCollaboratorRole role, CancellationToken cancellationToken = default)
        {
            LastCollaboratorRoleChange = (collectionId, ownerUserId, collaboratorUserId, role);
            return Task.CompletedTask;
        }

        public Task<CollectionCollaborationOverview> GetOverviewAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(new CollectionCollaborationOverview([], []));

        public Task RemoveCollaboratorAsync(long collectionId, long collaboratorUserId, CancellationToken cancellationToken = default)
        {
            LastRemoval = (collectionId, collaboratorUserId);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<ReceivedCollectionInvitationDto>> ListReceivedAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<ReceivedCollectionInvitationDto>>([]);

        public Task AcceptAsync(long userId, long invitationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task DeclineAsync(long userId, long invitationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
