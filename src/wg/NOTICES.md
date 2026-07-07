# Notices

Parts of the WorkGrid UI library (`src/wg/`) are adapted from the VS Code
source tree, which is licensed under the MIT License.

## VS Code / base layer

The `base/` directory (DOM utilities, common types, codicons, widgets: sash,
grid, tree, list, hover, menu, actionbar, button, inputbox, breadcrumbs, etc.)
and the `theme/colors/` color-token definitions are adapted from
`vs/base/**` and `vs/platform/theme/common/colors/**` of the VS Code project.

The full VS Code source and its contributors are credited in the upstream
repository: https://github.com/microsoft/vscode

## Codicon font

The codicon icon font (`base/browser/ui/codicons/codicon/codicon.ttf`) is
sourced from the `monaco-editor` npm package and is part of the VS Code
codicons project, licensed under the MIT License / CC-BY 4.0 for the glyphs:
https://github.com/microsoft/vscode-codicons

## Myers diff algorithm

`base/common/diff/diff.ts` is an implementation of the O(ND) difference
algorithm described in "An O(ND) Difference Algorithm and its variations" by
Eugene W. Myers, adapted from the VS Code diff library. The original
implementation carries its own copyright notice preserved inline in that file.

## License

All of the above are MIT-licensed. The WorkGrid UI library code (shell/,
editor/, theme shims, backend/) is part of the WorkGrid Studio project.
