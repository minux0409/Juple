/*
  Deactivates an Admin Web grant (emergency stop) - the person keeps their Juple account; their admin access ends with the very next
  request, because the Admin policy reads the grant on every request. The row is kept (IsActive = 0) for the record.

    sqlcmd -S <server> -d Juple -G -v JupleId="ABCD2345" -i infra/sql/admin/deactivate-admin.sql
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @JupleId nvarchar(16) = UPPER(REPLACE(REPLACE(LTRIM(RTRIM(N'$(JupleId)')), N'-', N''), N'@', N''));

UPDATE [admin].[AdminUsers]
SET [IsActive] = 0, [UpdatedAtUtc] = SYSUTCDATETIME()
WHERE [UserId] = (SELECT [Id] FROM [users].[Users] WHERE [PublicCode] = @JupleId)
  AND [IsActive] = 1;

IF @@ROWCOUNT = 0
    PRINT 'No active grant for this Juple ID. Nothing changed.';
ELSE
    PRINT 'Deactivated.';
