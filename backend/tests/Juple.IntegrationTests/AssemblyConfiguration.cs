using Xunit;

// Every integration test in this assembly shares one real SQL Server database (JupleDev locally),
// scoping its own rows by a freshly-created UserId rather than using isolated per-test databases or
// transactions. xUnit's default test-class-level parallelism was, in practice, producing rare
// cross-test-class flakiness under full-suite load (occasional FK violations / miscounted sends in
// otherwise-correct tests, never reproducible when a suspect test ran alone) - a known class of
// problem with parallel tests against one shared mutable database, not a defect in the store/service
// code itself. Disabling parallelization trades some wall-clock time for deterministic, trustworthy
// results, which matters far more for a shared-database integration suite.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
