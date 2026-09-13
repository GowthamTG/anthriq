# Issue tracker: GitHub

Issues and specifications live in this repository's GitHub Issues. Resolve the repository from
`git remote -v` and use the `gh` CLI.

- Publish a specification as an issue and apply the status label from the triage vocabulary.
- Write multiline issue bodies to a temporary file and use `gh issue create --body-file`; preserve
  Markdown and newlines.
- Read an issue with its body, labels, and comments before changing it.
- List, comment on, label, and close issues with the corresponding `gh issue` command. Verify the
  result after a write.
- Number implementation tickets individually and link them to their parent specification. Use native
  dependencies when available; otherwise use explicit `Blocked by: #N` references.
- Link implementation pull requests to the issue they address.

PRs as a request surface: no.
