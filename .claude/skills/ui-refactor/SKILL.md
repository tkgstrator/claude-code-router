---
name: ui-refactor
description: Review and refactor UI components for better design, accessibility, and consistency. Loads ux-designer skill knowledge to evaluate and improve existing interfaces.
user_invocable: true
---

# /ui-refactor - UI Refactoring Command

Review and improve existing UI components based on modern UX best practices.

## Instructions

### Step 1: Determine Scope

If the user specified a component or page, use that. Otherwise, ask which area to refactor:
- A specific component (e.g., "dashboard", "meal-form")
- A specific page (e.g., "/", "/settings")
- All components (full audit)

### Step 2: Load Context

Load the ux-designer skill for design knowledge by reading `.claude/skills/ux-designer/SKILL.md`.

Also read the project's design constraints:
- `src/index.css` for current color tokens and theme
- `CLAUDE.md` for coding conventions (shadcn/ui rules, animation rules, etc.)

### Step 3: Audit

For each component in scope, evaluate against these criteria:

**Visual Design**
- Color contrast (WCAG 2.2 AA: 4.5:1 for text, 3:1 for large text/UI)
- Spacing consistency (uses Tailwind spacing scale, no magic numbers)
- Typography hierarchy (clear heading levels, readable body text >= 16px)
- Dark/light mode parity (both themes look intentional, not broken)

**Interaction Design**
- Touch targets >= 44px for mobile
- Hover/focus/active states present
- Loading and error states handled
- Transitions are smooth (200-500ms)

**Accessibility**
- Semantic HTML elements used
- ARIA labels where needed
- Keyboard navigable
- Screen reader friendly

**Consistency**
- Follows shadcn/ui patterns (no direct edits to `src/components/ui/`)
- Uses project's CSS variables, not hardcoded colors
- Animation style matches existing motion patterns
- Form components use react-hook-form + zod pattern

**Mobile-First**
- Responsive layout works at 320px+
- No horizontal overflow
- Appropriate text sizes for mobile

### Step 4: Report

Present findings in Japanese as a structured report:

```
## UI リファクタリングレポート: [Component/Page]

### 問題点
| # | 重要度 | 箇所 | 問題 | 改善案 |
|---|--------|------|------|--------|
| 1 | 高/中/低 | file:line | ... | ... |

### 推奨変更 (優先順)
1. [高] ...
2. [中] ...
3. [低] ...

### 推定コスト: [S/M/L/XL]
```

### Step 5: Ask for Approval

Ask the user: **"この改善を実行してよろしいですか？全て / 一部を選択 / キャンセル"**

### Step 6: Execute (after approval)

- Apply approved changes.
- Run `bunx biome check --write` after modifications.
- Do NOT edit files under `src/components/ui/` — override styles via className on the consumer side.
- Verify the build succeeds: `bun run build`.
- Report what was changed.