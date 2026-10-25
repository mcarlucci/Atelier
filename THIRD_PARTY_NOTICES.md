# Third-party notices

Atelier includes the following third-party software. Atelier itself is licensed under the [Functional Source License](LICENSE); these components keep their own licenses.

## Git

Atelier ships Git v2.56.0 as a separate program (in the app's `Resources/git` folder) and runs it to save and restore versions of your apps.

- **License:** GNU General Public License, version 2 (GPL-2.0-only). The full license text ships next to the program, in `Resources/git/<platform>/COPYING`.
- **Source code:** [github.com/git/git, tag v2.56.0](https://github.com/git/git/tree/v2.56.0).
- **Build:** the portable build from [dugite-native v2.56.0-1](https://github.com/desktop/dugite-native/releases/tag/v2.56.0-1) (GPL-2.0), the build GitHub Desktop uses. Its build scripts are at [github.com/desktop/dugite-native, tag v2.56.0-1](https://github.com/desktop/dugite-native/tree/v2.56.0-1). Atelier leaves out Git LFS, and on macOS and Linux Git Credential Manager, and otherwise ships the build unchanged.
- To get a copy of the complete corresponding source code on a physical medium, [open an issue](https://github.com/mcarlucci/Atelier/issues) on this repository.

## Node.js

Atelier ships Node.js (in the app's `Resources/node` folder) to install and run the apps you build. Node.js is licensed under the MIT License and includes third-party components under their own licenses. The full text ships with it, in `Resources/node/<version>/LICENSE`. Source code: [github.com/nodejs/node](https://github.com/nodejs/node).

## Lucide icons

Some icons in Atelier's interface (`src/renderer/src/ui/icons.tsx`) use path data from [Lucide](https://lucide.dev).

```
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

Lucide icons derived from the Feather project are also covered by:

```
The MIT License (MIT)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
