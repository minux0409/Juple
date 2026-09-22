using Juple.Domain.Users;

namespace Juple.Application.Users.CurrentUser;

public sealed record CurrentJupleUser(long UserId, string TimeZoneId, UserPlan Plan);
