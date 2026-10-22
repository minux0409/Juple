-- Review only. Execute from an already-approved SQL access environment.
-- No credentials, DDL or DML. Results contain migration names and schema metadata only.
SELECT MigrationId
FROM dbo.__EFMigrationsHistory
ORDER BY MigrationId;

SELECT s.name AS SchemaName, t.name AS TableName, c.name AS ColumnName,
       TYPE_NAME(c.user_type_id) AS DataType, c.max_length, c.is_nullable
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.columns AS c ON c.object_id = t.object_id
WHERE (s.name = N'admin' AND t.name IN
       (N'Expenses', N'ExpenseAttachments', N'ExpenseAuditLogs',
        N'ExpenseRecurringSchedules', N'ExpenseSyncRuns'))
   OR (s.name = N'analytics' AND t.name = N'UserDailyActivitiesKst')
   OR (s.name = N'push' AND t.name = N'PushDeviceRegistrations'
       AND c.name IN (N'ApnsEnvironment', N'PushTokenHash'))
ORDER BY s.name, t.name, c.column_id;

SELECT s.name AS SchemaName, t.name AS TableName, i.name AS IndexName,
       i.is_unique, i.is_disabled
FROM sys.indexes AS i
JOIN sys.tables AS t ON t.object_id = i.object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE s.name IN (N'admin', N'analytics')
   OR (s.name = N'users' AND t.name = N'Users')
   OR (s.name = N'items' AND t.name = N'Items')
   OR (s.name = N'collections' AND t.name = N'Collections')
ORDER BY s.name, t.name, i.name;
