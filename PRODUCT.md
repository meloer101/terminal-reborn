# Product

## Register

product

## Users

Developers who run several CLI coding agents (Claude Code, Codex) at once, each in its own git worktree — typically 3–10 parallel sessions. They spend hours a day steering agents: writing prompts, approving tool calls, answering questions, reviewing diffs and merging branches. Many are Chinese speakers who type mixed Chinese/English prompts.

## Product Purpose

A macOS terminal built for agent-driven, multi-threaded development. It keeps each agent's native TUI intact and adds: a real desktop text editor for prompts, an at-a-glance view of what every agent is doing and which ones need you, one-click answers to agent questions, the full worktree lifecycle (create → review → merge → clean up), and a git graph that shows every worktree and its agent. Success: the user never loses track of an agent, never waits on one that silently needs them, and merges parallel work without leaving the app.

## Brand Personality

Quiet, precise, in control. The chosen direction is the restrained dark baseline in the Figma file (with a matching light mode): chroma-0 neutrals, color reserved for status, hierarchy built from typography, alignment and hairline dividers, small radii. Literal art-movement skins (ukiyo-e, Swiss, constructivism, title-sequence serif) were explored and rejected; distinctiveness comes from refinement, not costume.

The product must feel like a confident instrument, not a toy.

## Anti-references

- Orca, Superset, Emdash, Conductor: the generic "dark sidebar + terminal + diff panel" agent-IDE look. The first TerminalReborn draft resembled Orca too closely.
- AI-SaaS defaults: purple/blue gradients, glassmorphism, card grids, tiny uppercase eyebrows, neon-on-black "hacker" terminals.
- Over-decorated dev tools where the theme fights the content.

## Design Principles

1. The terminal is the work; everything else serves it. Decoration never covers agent output.
2. Interrupt only when needed. "Needs you" is the single loudest signal in the interface.
3. Commit to the aesthetic. Type, color, layout, icons and state language all speak the same visual dialect.
4. Keyboard first. Every frequent action, including answering an agent, works without the mouse.
5. Bilingual by design. Chinese and English text are both first-class, and CJK stays aligned on the terminal grid.

## Accessibility & Inclusion

WCAG 2.2 AA contrast for text and status indicators. Status is never conveyed by color alone (shape and wording too). Full keyboard operation. Respect reduced-motion. CJK input-method safety in every text field.
