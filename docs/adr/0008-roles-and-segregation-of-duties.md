# ADR-0008: Roles and segregation of duties

- **Status:** Accepted
- **Date:** 2026-09-25
- **ภาษาไทย:** [0008-roles-and-segregation-of-duties.th.md](0008-roles-and-segregation-of-duties.th.md)

## Context

In an ERP the most basic control an auditor checks is that the person who commits the company to
spend money, or who writes stock off, is not the same person who approves it. Roles alone do not
guarantee that: a small chain will often give one person several roles.

## Decision

1. **Seven roles in v1:**

   | Role | Can |
   |---|---|
   | `admin` | Manage users, roles, locations, configuration; reopen closed periods |
   | `purchasing` | Create and send purchase orders; manage suppliers |
   | `purchasing_approver` | Approve purchase orders above the approval threshold |
   | `plant` | Receive goods, run production orders, manage plant stock |
   | `logistics` | Dispatch transfers |
   | `branch_manager` | Raise requisitions, receive transfers, count branch stock |
   | `finance` | View costs, variances and valuation; export financial data |

2. **A user may hold several roles.**
3. **Nobody approves a document they created,** whatever roles they hold. This applies to purchase
   orders above the threshold, out-of-tolerance receipts, stock count adjustments and write-offs.
   The check is enforced in the service layer on every approval, not only hidden in the UI.
4. **Every posting and every approval records who and when** (ADR-0003).

## Consequences

- A one-person pilot needs a second account to approve anything that requires approval. This is
  intended: it is the control working.
- Thresholds (for example the purchase order value that needs approval) are configuration, not code.

## Alternatives considered

- **Role checks only.** Rejected: one user with both roles could create and approve their own
  purchase order.
- **Configurable workflows with multiple approval levels in v1.** Deferred: a single approval step
  with segregation is the control that matters; multi-level workflows add configuration surface
  without adding a different control.
