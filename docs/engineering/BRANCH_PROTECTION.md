# Branch Protection Baseline

For the default branch, require:

- pull request before merge;
- required status check: `Quality Gate`;
- branch must be up to date before merge where practical;
- conversation resolution;
- no force push;
- no branch deletion;
- CODEOWNERS review for security/architecture-critical areas when CODEOWNERS is introduced.

Do not make individual internal job names the only permanent branch-protection
contract. The final `Quality Gate` job provides one stable required check while
still requiring all upstream jobs.

Repository administrators should avoid bypassing the gate except for documented
incident recovery.
