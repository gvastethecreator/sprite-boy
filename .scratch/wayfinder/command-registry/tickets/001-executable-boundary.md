# Keep command metadata data-only and execution port-bound

Type: decision
Status: resolved
Blocked by: None

## Question

Should command definitions embed callbacks supplied ad hoc by components, or
should one registry own execution through an exhaustive handler port?

## Answer

Publish deeply immutable, data-only command metadata. Build the executable
registry only when a complete `StudioCommandHandlers` port is supplied and
runtime-validated. The registry maps every canonical command ID to exactly one
port call and refuses disabled execution before touching the handler.

This cannot prove that arbitrary host code has useful side effects, but it
eliminates missing handlers, empty callbacks stored in visible metadata and
drift between keyboard/palette/header definitions. Analyze is omitted until a
real capability/handler exists. F6-03 will adapt current host actions; F6-06
will remove remaining legacy command arrays and hardcoded keyboard branches.
