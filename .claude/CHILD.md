# Child fork overrides

<!--
This file is the child-owned extension point for the Claude Code toolkit.
It is marked `merge=ours` in .gitattributes, so `yarn core:sync` NEVER
overwrites it: core ships this template once, then it is yours to edit.
Core skills/agents/commands keep flowing down via core:sync as usual — only
THIS file is frozen to your version.

Put here anything specific to THIS fork that core's shared instructions should
not carry: store conventions, naming rules, the list of builder agents your
team has authored, internal links, gotchas. It is imported into CLAUDE.md on
every session (via `@.claude/CHILD.md`), and anything here overrides the core
defaults stated above it.

Keep it short. Leave the file in place (even if you empty the example below)
so the import never breaks.
-->

<!-- Example — delete and replace with your own:

## Conventions for this store
- Section / block prefix: `motrix-`
- Brand color tokens: `--color-brand-*`

## Slack bug list (used by the slack-bug-list skill)
- Slack bug list: F0XXXXXXX  (Copy Link on the fork's List → the F… id)

## Builder agents we authored (clones of feature-builder)
- `motrix-promo-builder` — builds promo sections (store promo rules on top of the contract).
  Run via: /build-batch --agent=motrix-promo-builder summer-sale, flash-deal
-->
