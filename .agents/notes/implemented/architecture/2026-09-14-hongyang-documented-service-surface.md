# Agent Note: Hongyang finance service documentation

Status: implemented

English | [中文](2026-09-14-hongyang-documented-service-surface.zh.md)

## Problem

The Hongyang finance service is callable through the same typed plugin host as other services. Missing return annotations and catalog ownership prevent its methods from participating in generated documentation. A working payment demo alone does not prove that the host's source-level contracts remain complete.

## Decision

The finance service declares explicit return types, and its exported helpers describe their inputs and results. The Hongyang package group owns a [subsystem reference](../../../../docs/subsystems/hongyang.md), and repository generators project that service into the existing catalogs. The DingTalk package is documented as the bundle declared by its package manifest. Documentation checks retain their existing acceptance rules.

The dated [handoff](../../../../docs/hongyang/CLAUDE_HANDOFF_2026-09-14.md) separates code and static-check evidence from real-client card delivery, callback processing, and financial acceptance. Those business limitations remain explicit even when static checks pass.

## Alternatives considered

**Exclude Hongyang from the generators.** This would conceal a host service that clients and tools can call, leaving its discovery and documentation inconsistent with the rest of the repository.

**Treat a text fallback as successful card delivery.** The user needs an interactive confirmation card. A text reply establishes neither successful card rendering nor a working button callback, so the handoff records these as separate verification outcomes.

## Consequences

Service type changes require generated catalogs and both documentation languages to stay synchronized. This maintenance cost gives downstream developers an inspectable service definition without changing monetary calculations or database records. Runtime finance and DingTalk tests remain necessary alongside documentation checks; static checks cannot establish external DingTalk delivery.
