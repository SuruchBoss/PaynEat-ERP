# Contributing to PaynEat ERP

Contributions are welcome. Everything outside `ee/` is licensed under the
[Apache License, Version 2.0](LICENSE), and so are contributions to it. `ee/` is licensed under the
[Elastic License 2.0](ee/LICENSE) (ADR-0015).

Before changing anything, read:

- [`CLAUDE.md`](CLAUDE.md): the working rules, the definition of done, the domain rules that must never
  be broken, and the gates every commit passes (the same ones CI runs);
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md) and [`docs/adr/`](docs/adr/README.md): the vocabulary and the
  decisions behind the design.

Work is tracked in GitHub Issues: one issue, one branch, one pull request that says `Closes #<number>`.

ยินดีรับการร่วมพัฒนา ทุกอย่างนอก `ee/` ใช้ Apache 2.0 ส่วน `ee/` ใช้ Elastic License 2.0 อ่าน `CLAUDE.md`,
`docs/GLOSSARY.md` และ ADR ก่อนแก้โค้ด และ **ทุก commit ใน pull request จาก fork ต้อง sign off ตาม DCO**
(`git commit -s`) ตามรายละเอียดด้านล่าง

## Developer Certificate of Origin (DCO)

Contributions are accepted under the project's license (see [LICENSE](LICENSE) and, where a
directory has its own, that directory's license). So that the origin of every change is clear,
**each commit in a pull request from a fork must be signed off** under the Developer Certificate
of Origin 1.1. CI checks it (`.github/workflows/license-check.yml`).

Sign off with `git commit -s`. It adds a line with the name and email of the commit's author:

```
Signed-off-by: Your Name <you@example.com>
```

By signing off you certify the following (the full text of the DCO, from
<https://developercertificate.org/>):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

A sign-off is a statement made by a person. Automated tools and AI agents do not sign off on
anyone's behalf; the person who submits their work does.

## File headers

Every source file starts with its copyright and license identifier, for example:

```ts
// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0
```

`node scripts/license-headers.mjs --fix` adds it to new files; CI fails a file without it.
Files under `ee/` use `SPDX-License-Identifier: Elastic-2.0` instead. Applied database migrations are
exempt, because editing one changes its recorded checksum.
