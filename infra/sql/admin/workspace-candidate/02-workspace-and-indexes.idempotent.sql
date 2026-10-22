BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    ALTER TABLE [admin].[Expenses] DROP CONSTRAINT [CK_Expenses_Status];
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    ALTER TABLE [admin].[Expenses] ADD [CustomCategory] nvarchar(80) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    ALTER TABLE [admin].[Expenses] ADD [ExchangeRateSource] nvarchar(200) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    ALTER TABLE [admin].[Expenses] ADD [PeriodFrom] date NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    ALTER TABLE [admin].[Expenses] ADD [PeriodThrough] date NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    CREATE TABLE [analytics].[UserDailyActivitiesKst] (
        [Id] bigint NOT NULL IDENTITY,
        [UserId] bigint NOT NULL,
        [Date] date NOT NULL,
        [Platform] nvarchar(16) NOT NULL,
        [LastSeenAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_UserDailyActivitiesKst] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_UserDailyActivitiesKst_Users_UserId] FOREIGN KEY ([UserId]) REFERENCES [users].[Users] ([Id]) ON DELETE CASCADE
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    EXEC(N'ALTER TABLE [admin].[Expenses] ADD CONSTRAINT [CK_Expenses_Status] CHECK ([Status] IN (''Estimated'',''Paid'',''Cancelled'',''Provisional''))');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    CREATE INDEX [IX_UserDailyActivitiesKst_Date] ON [analytics].[UserDailyActivitiesKst] ([Date]) INCLUDE ([UserId], [Platform]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    CREATE UNIQUE INDEX [IX_UserDailyActivitiesKst_UserId_Date_Platform] ON [analytics].[UserDailyActivitiesKst] ([UserId], [Date], [Platform]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022033737_AddAdminWorkspace'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022033737_AddAdminWorkspace', N'10.0.11');
END;

COMMIT;
GO

BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022035853_AddAdminWorkspaceQueryIndexes'
)
BEGIN
    CREATE INDEX [IX_Users_CreatedAtUtc] ON [users].[Users] ([CreatedAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022035853_AddAdminWorkspaceQueryIndexes'
)
BEGIN
    CREATE INDEX [IX_Items_SavedAtUtc] ON [items].[Items] ([SavedAtUtc]) INCLUDE ([UserId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022035853_AddAdminWorkspaceQueryIndexes'
)
BEGIN
    CREATE INDEX [IX_Expenses_Source_SubscriptionId_OccurredOn] ON [admin].[Expenses] ([Source], [SubscriptionId], [OccurredOn]) INCLUDE ([ResourceGroup], [NoLongerReported], [DeletedAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022035853_AddAdminWorkspaceQueryIndexes'
)
BEGIN
    CREATE INDEX [IX_Collections_CreatedAtUtc] ON [collections].[Collections] ([CreatedAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261022035853_AddAdminWorkspaceQueryIndexes'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261022035853_AddAdminWorkspaceQueryIndexes', N'10.0.11');
END;

COMMIT;
GO
