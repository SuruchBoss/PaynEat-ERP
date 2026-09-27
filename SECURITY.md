# Security policy

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/SuruchBoss/PaynEat-ERP/security/advisories/new)
(Security → Report a vulnerability). Include what the problem is and why it matters, the shortest way to
reproduce it, and the affected version or commit. A suggested fix is welcome. Say whether you would like
credit in the advisory.

If you are unsure whether something counts, report it privately anyway. That includes anything that gets
past authentication, the second factor, permissions, segregation of duties (ADR-0008), the ledger's rules
(ADR-0003), or a POS machine credential. A private report can be made public later; a public one cannot be
taken back.

A problem found in another project of the PaynEat ecosystem goes to that project's own private channel, not
here. Why, and how it may be referred to once fixed: [ADR-0022](docs/adr/0022-vulnerability-disclosure-across-the-ecosystem.md).

## Supported versions

The ERP is before its first release (v1.0.0, #29). Security fixes land on `main`.
