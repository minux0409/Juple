namespace Juple.Application.Push.DispatchDuePushNotifications;

public sealed record DispatchDuePushNotificationsResult(
    int CandidateUsers, int Attempted, int Sent, int Failed, int Skipped);
