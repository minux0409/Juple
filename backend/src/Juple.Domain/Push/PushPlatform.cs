namespace Juple.Domain.Push;

/// <summary>
/// Numeric values are fixed and persisted; do not reorder or reuse a value for a different
/// meaning. Add new members with new numeric values. Mirrors Juple.Domain.Notifications.
/// NotificationType's identical convention.
/// </summary>
public enum PushPlatform : byte
{
    Android = 0,
    Ios = 1,
}
