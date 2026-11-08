# Building in the workspace

[← Back to README](../README.md)

## Create an app

Create an app from a sandbox template (see [Templates](templates.md)) that can load the design system. Generated setup files load its stylesheet, provider, Vue plugin or Angular root modules.

## Chat

Each turn sends the base prompt plus rules generated from the catalog (cached), the full codebase, and the app notes to the model. The reply's `<atelier-*>` action tags are applied, packages installed, the result committed to git, and then checked for compliance.

## Preview

The preview runs in an iframe from the app's own dev server (port 32100+).

### Select and edit

The **select** tool (pointer button in the preview bar) edits the page directly:

- Drag a selected element (or press <kbd>Alt</kbd>+arrows) to reorder it among its siblings.
- Double-click text to change it.
- **Save** makes one new version. Text that appears exactly once in the source is patched directly. Anything else (moves, ambiguous text) is sent to the AI as one turn.
- **Discard** reloads the page.

### Ask AI

The **Ask AI** button asks for a change to the selected element. The request is sent with the element's route, text, HTML, key computed styles, owning components and, for React and Vue, its source file.

## The chat can see the preview

While the app is running, the AI can look at it and use it, in a private copy of the page that never touches the preview you see or the app's files:

- **Screenshot** at any width (for example a phone), **inspect** (headings, buttons, links and fields with their names and values, missing labels and alt text, visible text) and **console** (errors, warnings and build errors).
- **Click** and **type** to walk through a form or a dialog.
- **Browser checks:** the Invariant UI checks for layout at phone, tablet and desktop widths, language and alt text.

The tools show the app as it was when the turn started, because the AI's edits are applied when it finishes. So after every build Atelier opens the app fresh itself. If the page is blank or throws errors, the message says so and Atelier asks the AI to fix it once, using the tools; if the fix also fails, a **Fix with AI** button lets you decide. A message whose preview was checked and is fine shows a "Preview checked" pill.

## Versions, code and console

- **Versions** lists every commit and can restore any of them.
- **Code** lets you edit files. <kbd>⌘S</kbd>/<kbd>Ctrl+S</kbd> saves and commits the change, so it appears in **Versions**. Generated setup files are read-only.
- **Console** shows the dev server's output and counts errors. **Fix error** sends the latest error to the AI.
