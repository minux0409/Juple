BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE TABLE [admin].[ExpenseAuditLogs] (
        [Id] bigint NOT NULL IDENTITY,
        [AdminUserId] bigint NULL,
        [Action] nvarchar(64) NOT NULL,
        [ExpenseId] bigint NULL,
        [BeforeJson] nvarchar(max) NULL,
        [AfterJson] nvarchar(max) NULL,
        [CreatedAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ExpenseAuditLogs] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE TABLE [admin].[Expenses] (
        [Id] bigint NOT NULL IDENTITY,
        [RequestId] uniqueidentifier NOT NULL,
        [Source] nvarchar(16) NOT NULL,
        [DeduplicationKey] char(64) NOT NULL,
        [Name] nvarchar(200) NOT NULL,
        [Provider] nvarchar(200) NOT NULL,
        [Category] nvarchar(32) NOT NULL,
        [OccurredOn] date NOT NULL,
        [PaidOn] date NULL,
        [Currency] char(3) NOT NULL,
        [NetAmount] decimal(28,12) NULL,
        [TaxAmount] decimal(28,12) NULL,
        [GrossAmount] decimal(28,12) NOT NULL,
        [PaymentMethod] nvarchar(80) NOT NULL,
        [Status] nvarchar(16) NOT NULL,
        [Kind] nvarchar(16) NOT NULL,
        [InvoiceReference] nvarchar(200) NULL,
        [Memo] nvarchar(2000) NULL,
        [ConvertedCurrency] char(3) NULL,
        [ExchangeRate] decimal(28,12) NULL,
        [ExchangeRateOn] date NULL,
        [OriginalExpenseId] bigint NULL,
        [ReconciledByExpenseId] bigint NULL,
        [SubscriptionId] nvarchar(36) NULL,
        [ResourceGroup] nvarchar(90) NULL,
        [ServiceName] nvarchar(200) NULL,
        [Environment] nvarchar(32) NULL,
        [RawImportedAmount] nvarchar(64) NULL,
        [NoLongerReported] bit NOT NULL,
        [CreatedByAdminUserId] bigint NULL,
        [CreatedAtUtc] datetimeoffset NOT NULL,
        [UpdatedAtUtc] datetimeoffset NOT NULL,
        [DeletedAtUtc] datetimeoffset NULL,
        [Revision] bigint NOT NULL,
        CONSTRAINT [PK_Expenses] PRIMARY KEY ([Id]),
        CONSTRAINT [CK_Expenses_Amounts] CHECK (([NetAmount] IS NULL AND [TaxAmount] IS NULL) OR ([NetAmount] IS NOT NULL AND [TaxAmount] IS NOT NULL AND [NetAmount]+[TaxAmount]=[GrossAmount])),
        CONSTRAINT [CK_Expenses_Kind] CHECK ([Kind] IN ('Charge','Refund','Adjustment')),
        CONSTRAINT [CK_Expenses_Revision] CHECK ([Revision] > 0),
        CONSTRAINT [CK_Expenses_Source] CHECK ([Source] IN ('Manual','Recurring','Azure')),
        CONSTRAINT [CK_Expenses_Status] CHECK ([Status] IN ('Estimated','Paid','Cancelled')),
        CONSTRAINT [FK_Expenses_Expenses_OriginalExpenseId] FOREIGN KEY ([OriginalExpenseId]) REFERENCES [admin].[Expenses] ([Id]),
        CONSTRAINT [FK_Expenses_Expenses_ReconciledByExpenseId] FOREIGN KEY ([ReconciledByExpenseId]) REFERENCES [admin].[Expenses] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE TABLE [admin].[ExpenseSyncRuns] (
        [Id] bigint NOT NULL IDENTITY,
        [Scope] nvarchar(256) NOT NULL,
        [Environment] nvarchar(32) NOT NULL,
        [Month] date NOT NULL,
        [LeaseKey] char(64) NOT NULL,
        [LeaseId] uniqueidentifier NULL,
        [LeaseUntilUtc] datetimeoffset NULL,
        [LastStartedAtUtc] datetimeoffset NULL,
        [LastSuccessAtUtc] datetimeoffset NULL,
        [Status] nvarchar(16) NOT NULL,
        [FailureCode] nvarchar(64) NULL,
        [ImportedRows] int NOT NULL,
        [Revision] bigint NOT NULL,
        CONSTRAINT [PK_ExpenseSyncRuns] PRIMARY KEY ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE TABLE [admin].[ExpenseAttachments] (
        [Id] bigint NOT NULL IDENTITY,
        [ExpenseId] bigint NOT NULL,
        [RequestId] uniqueidentifier NOT NULL,
        [FileName] nvarchar(120) NOT NULL,
        [ContentType] nvarchar(64) NOT NULL,
        [BlobName] nvarchar(200) NOT NULL,
        [Sha256] char(64) NOT NULL,
        [Bytes] bigint NOT NULL,
        [State] nvarchar(24) NOT NULL,
        [CreatedAtUtc] datetimeoffset NOT NULL,
        CONSTRAINT [PK_ExpenseAttachments] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ExpenseAttachments_Expenses_ExpenseId] FOREIGN KEY ([ExpenseId]) REFERENCES [admin].[Expenses] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE TABLE [admin].[ExpenseRecurringSchedules] (
        [Id] bigint NOT NULL IDENTITY,
        [TemplateExpenseId] bigint NOT NULL,
        [Frequency] nvarchar(16) NOT NULL,
        [NextDueOn] date NOT NULL,
        [AnchorDay] int NOT NULL,
        [AnchorMonth] int NOT NULL,
        [IsEnabled] bit NOT NULL,
        [Revision] bigint NOT NULL,
        CONSTRAINT [PK_ExpenseRecurringSchedules] PRIMARY KEY ([Id]),
        CONSTRAINT [FK_ExpenseRecurringSchedules_Expenses_TemplateExpenseId] FOREIGN KEY ([TemplateExpenseId]) REFERENCES [admin].[Expenses] ([Id])
    );
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE UNIQUE INDEX [IX_ExpenseAttachments_BlobName] ON [admin].[ExpenseAttachments] ([BlobName]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    EXEC(N'CREATE UNIQUE INDEX [IX_ExpenseAttachments_ExpenseId_Sha256] ON [admin].[ExpenseAttachments] ([ExpenseId], [Sha256]) WHERE [State] <> ''Deleted''');
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE UNIQUE INDEX [IX_ExpenseAttachments_RequestId] ON [admin].[ExpenseAttachments] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE INDEX [IX_ExpenseAttachments_State_CreatedAtUtc] ON [admin].[ExpenseAttachments] ([State], [CreatedAtUtc]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE INDEX [IX_ExpenseAuditLogs_ExpenseId_Id] ON [admin].[ExpenseAuditLogs] ([ExpenseId], [Id]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE INDEX [IX_ExpenseRecurringSchedules_IsEnabled_NextDueOn] ON [admin].[ExpenseRecurringSchedules] ([IsEnabled], [NextDueOn]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE UNIQUE INDEX [IX_ExpenseRecurringSchedules_TemplateExpenseId] ON [admin].[ExpenseRecurringSchedules] ([TemplateExpenseId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Expenses_DeduplicationKey] ON [admin].[Expenses] ([DeduplicationKey]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE INDEX [IX_Expenses_OccurredOn_Currency_Status] ON [admin].[Expenses] ([OccurredOn], [Currency], [Status]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE INDEX [IX_Expenses_OriginalExpenseId] ON [admin].[Expenses] ([OriginalExpenseId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE INDEX [IX_Expenses_ReconciledByExpenseId] ON [admin].[Expenses] ([ReconciledByExpenseId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE UNIQUE INDEX [IX_Expenses_RequestId] ON [admin].[Expenses] ([RequestId]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    CREATE UNIQUE INDEX [IX_ExpenseSyncRuns_LeaseKey] ON [admin].[ExpenseSyncRuns] ([LeaseKey]);
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261020110000_AddBusinessExpenses'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261020110000_AddBusinessExpenses', N'10.0.11');
END;

COMMIT;
GO
