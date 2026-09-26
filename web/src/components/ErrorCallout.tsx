import type { MessageKey } from '@/i18n/catalogue';
import { useI18n } from '@/i18n/useI18n';
import { ApiError } from '@/lib/api-error';

/**
 * An error the person can act on: a message chosen from the API's stable `code` (never
 * its English text), and — for anything the person cannot fix themselves — the
 * correlation id to quote when reporting it (ADR-0011).
 */
export function ErrorCallout({
  error,
  messages = {},
}: {
  error: unknown;
  /** Message for each API error code this screen explains. */
  messages?: Readonly<Record<string, MessageKey>>;
}) {
  const { t } = useI18n();
  const apiError = error instanceof ApiError ? error : undefined;
  const known = apiError ? messages[apiError.code] : undefined;
  const key: MessageKey =
    known ??
    (apiError?.isUnreachable
      ? 'error.unreachable'
      : apiError?.status === 429
        ? 'error.rateLimited'
        : 'error.unexpected');

  return (
    <div className="callout callout--danger" role="alert">
      <p>{t(key)}</p>
      {!known && apiError?.requestId && (
        <p className="subtle">
          {t('status.correlationId')}: <code>{apiError.requestId}</code>
        </p>
      )}
    </div>
  );
}
