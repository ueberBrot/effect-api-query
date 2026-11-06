# Extend reviewed Effect support through 4.1

Status: Accepted. Amends the supported range in [ADR 0033](0033-bound-effect-support-to-a-patch-line.md).

## Context

Effect 4.1.0 is eligible under the seven-day dependency policy. Its unstable platform APIs move the `ws` constructor to `NodeWS` and replace the previous crypto service. These changes affect development fixtures and measurements. The adapter requires no new API that would justify raising its consumer minimum.

## Decision

Support `>=4.0.6 <4.2.0`, retaining the existing floor and admitting the reviewed 4.1 minor. Pin coordinated development runtime, testing, and Node platform packages to `4.1.0`. Review later minors before widening the upper bound. Patch eligibility and lifecycle-script permissions retain their existing policy.

Use the shared `NodeSocket.layerWebSocketConstructor` in fixtures compiled at both releases. Use `NodeWS.layerWebSocketConstructor` for the development transport measurements that require `ws` backpressure. Use Node's SHA-256 implementation for measurement fingerprints; this preserves the digest format without introducing a consumer dependency on either Effect crypto API.

## Evidence and consequences

The packed library passes its public fixtures on TypeScript 7.0.2 and 5.9.3 and 163 selected runtime cases at both Effect 4.0.6 and 4.1.0. Native framework consumers pass on both compilers. All 800 runtime tests pass on the development release. The package builds and validates its declarations and exports without runtime adapter changes.

These checks establish the two named combinations. They do not certify every intermediate release, backport transport fixes, or establish support for Effect 4.2. Problem Details remains an application-level opt-in in Effect 4.1; this change does not add a package error format or alter the preserved Cause.
