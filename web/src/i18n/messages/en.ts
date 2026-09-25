import type { Messages } from './th';

export const en: Messages = {
  'app.name': 'PaynEat ERP',

  'shell.skipToContent': 'Skip to main content',
  'shell.mainNavigation': 'Main navigation',
  'shell.openNavigation': 'Open menu',
  'shell.closeNavigation': 'Close menu',

  'nav.section.system': 'System',
  'nav.status': 'System status',

  'language.label': 'Language',
  // Each language is always named in itself, so a person who cannot read the current
  // language can still find theirs.
  'language.th': 'ไทย',
  'language.en': 'English',

  'status.title': 'System status',
  'status.intro': "Checks whether the ERP's API and its database are answering normally.",
  'status.refresh': 'Check again',
  'status.checking': 'Checking…',
  'status.checkedAt': 'Last checked {time}',
  'status.components': 'System components',
  'status.column.component': 'Component',
  'status.column.state': 'State',
  'status.component.api': 'API',
  'status.component.database': 'Database',
  'status.state.up': 'Healthy',
  'status.state.down': 'Not healthy',
  'status.state.unknown': 'Unknown',
  'status.overall.ok': 'Everything is healthy',
  'status.overall.degraded': 'Something is not healthy',
  'status.overall.unreachable': 'The API cannot be reached',
  'status.error.unreachable':
    'The API did not answer. Check that the server is running, then try again.',
  'status.error.http': 'The API answered with an error (HTTP {status})',
  'status.error.invalid': 'The API answered in a format the console does not recognise',
  'status.correlationId': 'Correlation ID',
  'status.correlationIdHint':
    'Quote this when you report the problem: it finds the log lines of this exact request.',

  'notFound.title': 'Page not found',
  'notFound.body': 'The link may be wrong, or the page has moved.',
  'notFound.back': 'Back to system status',
};
