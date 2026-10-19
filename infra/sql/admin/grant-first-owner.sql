/*
  Grants the FIRST Admin Web owner - a one-time operator procedure (see docs/admin.md). Run it with sqlcmd and an operator's own
  database login (never the application's identity), supplying the person's Juple ID as a variable:

    sqlcmd -S <server> -d Juple -G -v JupleId="ABCD2345" -i infra/sql/admin/grant-first-owner.sql

  - No email, internal UserId or person is written in this file or in any migration: the Juple ID is given at run time.
  - The person must already have a Juple account (sign in to the app once first).
  - It refuses to run when an active Owner already exists - further admins are granted by an Owner later, through an audited flow.
  - Idempotent for the same person: a second run changes nothing.
*/
SET XACT_ABORT ON;
SET NOCOUNT ON;

DECLARE @JupleId nvarchar(16) = UPPER(REPLACE(REPLACE(LTRIM(RTRIM(N'$(JupleId)')), N'-', N''), N'@', N''));
DECLARE @UserId bigint;

BEGIN TRANSACTION;

SELECT @UserId = [Id] FROM [users].[Users] WITH (UPDLOCK, HOLDLOCK) WHERE [PublicCode] = @JupleId;
IF @UserId IS NULL
BEGIN
    ROLLBACK TRANSACTION;
    THROW 51001, 'No Juple account has this Juple ID. Nothing was granted.', 1;
END;

IF EXISTS (SELECT 1 FROM [admin].[AdminUsers] WITH (UPDLOCK, HOLDLOCK) WHERE [UserId] = @UserId AND [Role] = N'Owner' AND [IsActive] = 1)
BEGIN
    COMMIT TRANSACTION;
    PRINT 'This Juple ID is already the active Owner. Nothing changed.';
    RETURN;
END;

IF EXISTS (SELECT 1 FROM [admin].[AdminUsers] WHERE [Role] = N'Owner' AND [IsActive] = 1)
BEGIN
    ROLLBACK TRANSACTION;
    THROW 51002, 'An active Owner already exists. The first-owner procedure is for an empty grant table only.', 1;
END;

IF EXISTS (SELECT 1 FROM [admin].[AdminUsers] WHERE [UserId] = @UserId)
BEGIN
    UPDATE [admin].[AdminUsers]
    SET [Role] = N'Owner', [IsActive] = 1, [UpdatedAtUtc] = SYSUTCDATETIME()
    WHERE [UserId] = @UserId;
END
ELSE
BEGIN
    INSERT INTO [admin].[AdminUsers] ([UserId], [Role], [IsActive], [GrantedByUserId], [CreatedAtUtc], [UpdatedAtUtc])
    VALUES (@UserId, N'Owner', 1, NULL, SYSUTCDATETIME(), SYSUTCDATETIME());
END;

COMMIT TRANSACTION;
PRINT 'Granted: this Juple ID is now the active Owner of the Admin Web.';
