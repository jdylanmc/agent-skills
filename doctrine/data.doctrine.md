---
name: data
description: "Data-systems discipline for ownership, consistency, durability, evolution, replay, and distributed failure."
scope: shared-engineering-doctrine
---

# Data Doctrine

## When to use

Reach for this doctrine when a change can be wrong because of the way data is owned, agreed upon, made durable, copied between nodes, split across shards, versioned as it evolves, published as events, reprocessed from history, or maintained as a secondary representation.

## Primary bias to correct

Remote data gets reasoned about as though it behaved like a local variable. Refuse the unexamined belief that a write, a read, a queued message, a cached value, a replica, a clock reading, or a downstream side effect is in-process, delivered in the order it was produced, current at the moment it is used, and applied precisely one time.

## Decision rules

### State the contract before building it

- Put the governing trade-offs on the record: which store holds the truth, what consistency callers may expect, how retries behave, what happens when work arrives twice or out of sequence, what a partial failure leaves behind, how the data is permitted to change shape over time, and whether each piece of state is ephemeral, cached, derived, or durable.
- For every write, pin down the instant it survives a restart, the instant other readers can observe it, whether readers may be served an older value, which conflicting updates are possible, and how those conflicts get detected and settled.
- Budget for trouble as an ordinary operating condition rather than an exception: processes that crash, writes that finish halfway, work that runs more than once, requests that time out, reads that return outdated values, and calls whose downstream outcome is never learned. Keep "request accepted", "state written", "effect applied", and "guaranteed to survive failure" as four separate claims.

### Size the workload before reshaping the system

- Quantify the workload and its performance envelope before restructuring anything: request rates, the volume of data held and moved, how that data is genuinely read and written, the latency and throughput being asked for, the percentile spread hiding behind the averages, where bottlenecks and contention sit, and how the slowest requests behave. Collect the figures first and change the architecture afterward.

### Fit models, engines, and layouts to real access

- Derive the data model, the query interface, and the ownership boundary from the shape of the relationships, the reads and updates that actually run, the consistency callers require, how tightly related fields change together, the pressure to keep evolving, and whether the data is authoritative or reconstructible from something else.
- Select storage engines, index structures, and analytical layouts against the observed write mix, the observed read mix, whether ranges are scanned, what recovery demands, how much extra write work a design multiplies into, the separation between transactional and analytical use, and what is assumed to sit in memory versus on durable media.

### Treat every second copy as owned work

- Caches, indexes, materialized views, read models, search corpora, and denormalized fields are all copies of something else. Each needs a stated owner, a defined path by which updates reach it, a known lag, visibility into that lag, a way to repair drift, and a way to rebuild it from the authoritative source.

### Make repetition and replay harmless

- Commands, background jobs, emitted events, batch runs, and stream processors will execute again. Establish safety deliberately through deduplication keys, state transitions that are inherently repeatable, or a stated transactional recovery contract.
- Guard only the ordering that business rules genuinely require, and nothing beyond it. Name the scope that ordering holds within — a key, a stream, a partition, a record, the history of one entity, or a deliberately stronger guarantee — and keep order-sensitive logic inside that scope.
- Keep events, commands, streams, durable logs, and materialized views as separate concepts. An event asserts something that happened; whatever consumes it must cope with falling behind, seeing the same fact twice, restarting, reprocessing history, identifying records by stable keys, carrying correlation metadata, and reading payloads of more than one version.
- Batch and streaming pipelines must be re-runnable and restartable. Write down the inputs, the outputs, the intermediate state, the checkpoints, every side effect that escapes the pipeline, the difference between when an event happened, when it was ingested, and when it was processed, plus windowing, the handling of late arrivals, join behavior, and what is guaranteed from source through to sink.

### Version contracts for a system that never stops

- Encodings, schemas, database changes, published interfaces, events, and messages are contracts that must keep working while versions coexist. Design each change for readers still on old code, writers still on old code, records already stored, messages already in flight, upgrades that roll through gradually, and formats shared across service boundaries.

### Account for what distribution costs

- Pick a replication arrangement from the way writes arrive and the guarantees reads need: the latency budget, how many failures must be survivable, tolerable lag, what failover and reconfiguration involve, how conflicting updates are handled, whether a client must see its own writes, whether reads may move backwards in time, whether a consistent prefix of updates is required, what quorum is needed, and how divergent copies converge.
- Choose partition keys from the locality and consistency the workload demands, and state the bill in advance: hot keys, uneven distribution, routing, how secondary indexes behave, the cost of rebalancing, and operations that must span partitions.
- Fit transactions and isolation levels to the invariants being protected. Be explicit about what is atomic together, what commit means, how recovery proceeds, how mismatches are reconciled, and how lost updates, write skew, phantoms, and already-emitted side effects are prevented or repaired.
- Assume the environment misbehaves and record the fault model: delayed packets, dropped packets, network partitions, messages delivered twice, arbitrary process pauses, leaders that no longer hold authority, expired timeouts, wall-clock readings that cannot be trusted, leases, locks, majority decisions, and leadership itself.
- Reserve linearizability, totally ordered broadcast, atomic commitment, and consensus for problems that genuinely require participants to agree, and only where the resulting availability and latency bill is one the system can afford.

### Draw service boundaries where the data is owned

- A service boundary should follow who owns the data and who may change it. Resist splitting one business concept that must stay tightly consistent across two services, and keep talkative cross-service joins off latency-sensitive paths.

## Trigger rules

- **A write path is added or altered.** Name the owning store, the consistency boundary it sits behind, the point at which the write survives failure, the point at which it becomes visible, everything downstream it touches, how it is undone or repaired, and what happens when the request times out or its outcome cannot be determined.
- **A read model, search copy, projection, warehouse feed, index, cache, or denormalized field is introduced or changed.** Establish who owns it, how updates reach it, how stale it may become, what it costs on the write path, how its lag is surfaced, how it is rebuilt, and how it is repaired.
- **Retries, queues, consumers, background jobs, event sourcing, replayable batch work, change-data-capture, or stream processors are introduced.** Demonstrate rather than assert that duplicates, reprocessing, out-of-order arrival, retention limits, escaping side effects, and recovery are all safe.
- **Reads are served from a replica, or replication is asynchronous.** Determine whether the caller must see its own writes, whether it may observe time moving backwards, whether a consistent prefix is required, how much staleness is acceptable, how a lagging replica catches up, what failover does, and how conflicts resolve. Settle all of this before permitting the read.
- **Data or work is partitioned.** Push the everyday query through the design and check hot keys, routing metadata, skew, locality, how secondary indexes behave, the cost of rebalancing, and what coordination has to span partitions.
- **An isolation level is chosen or a consistency guarantee is relaxed.** Tie each anomaly the weaker setting permits to the specific invariant it can violate, then apply serializable isolation, locking, compare-and-set, version checks, reconciliation, or some other compensating mechanism wherever an invariant would otherwise break.
- **Leases, locks, timestamps, leadership, coordination services, majority decisions, or consensus-like machinery enter the design.** Spell out what is assumed about clocks, which quorum and session semantics apply, what happens when an authority is stale, and how fencing stops a deposed holder from acting.
- **A schema, interface, message, event, enumeration, status value, or payload meaning changes.** Plan compatibility for readers on old code, writers on old code, data already stored, messages already queued, and writers on new code, along with the rollout sequence and the migration.
- **Data-intensive code is reviewed or tested.** Hunt for this domain's characteristic failures: source-of-truth ownership that is implied instead of stated, operations that are unsafe to repeat, exactly-once behavior assumed but never provided, ordering relied on without a declared scope, schemas drifting apart, projections that cannot be rebuilt, writes fanned across stores with no stated contract, and lag or failure that nothing reports.

## Final checklist

- The authoritative copy is identified and every derived representation is labeled as derived.
- Consistency promises, durability points, visibility points, conflict rules, and the staleness allowed are all expressed in concrete terms.
- Retries, crashes, timeouts, unknown outcomes, repeated delivery, reprocessing, and out-of-order arrival all have defined behavior.
- Schemas, encodings, interfaces, messages, events, enumerations, and status values survive a deployment where several versions run at once.
- Replication, partitioning, routing, storage engines, indexing, and analytical layouts are justified by the measured workload.
- The chosen isolation and coordination mechanisms defend the invariants that were actually named.
- Projections, streams, durable logs, emitted events, and batch jobs can be reprocessed, or carry a documented repair path instead.
- Service boundaries line up with data ownership and the right to update.
- Retries, failures, rebuilds, repairs, and lag are visible to operators.
- Nothing in the design leans on exactly-once delivery or on an unstated distributed-system guarantee.
