# 1. Record architecture decisions

Date: 2026-09-18

## Status

Accepted

## Context

This project makes several decisions that look arbitrary from the code alone — why the microphone is analysed twice, why the stage lags the music, why TypeScript is pinned a major behind the current release. Without the reasoning written down, the next person to touch them (including the author, in six months) will see only the constraint and not the trade-off, and will either work around it or undo it.

## Decision

Architecture decisions are recorded as short numbered files in `docs/adr/`, following Michael Nygard's format: context, decision, consequences.

An ADR is written when a decision is hard to reverse, constrains later work, or will look wrong without its reasoning. Routine choices stay in code comments.

Superseded ADRs are kept and marked, not deleted.

## Consequences

The record of _why_ survives the code that implemented it. Reversing a decision means writing the ADR that supersedes it, which forces the new trade-off to be stated as explicitly as the old one.
