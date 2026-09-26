// Copyright 2026 Suruch Chakrapeesirisuk
// SPDX-License-Identifier: Apache-2.0

// Adapted from Cwork (backend/src/core/config/config.token.ts), see NOTICE.
/**
 * The injection token, on its own, with nothing else in the file.
 *
 * It used to live in `config.module.ts` beside `AppConfigModule`, and that made
 * `import { APP_CONFIG }` a side effect: loading the module file evaluates its
 * `@Module` decorator, which evaluates `NestConfigModule.forRoot({ validate })`,
 * which validates `process.env` there and then. Any file that named the token —
 * dragged the whole environment check in behind it.
 *
 * The visible cost was `npm test` on a clean clone. `knowledge.service.spec.ts`
 * is a unit test that touches neither a database nor a config; it failed to
 * load, because the service it tests names this token, so six tests never ran
 * at all. CI never saw it: the job sets DATABASE_URL and the secrets for the
 * end-to-end step, so the environment the check demands was always present.
 * A reviewer cloning the repository has none of that.
 *
 * Nothing in here may import anything that registers a module or reads
 * `process.env`. A `Symbol` is all it should ever hold.
 */
export const APP_CONFIG = Symbol('APP_CONFIG');
