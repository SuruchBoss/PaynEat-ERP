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

  'nav.section.administration': 'Administration',
  'nav.users': 'Users and roles',
  'session.signedInAs': 'Signed in as',
  'session.signOut': 'Sign out',
  'auth.checkingSession': 'Checking your sign-in…',
  'auth.forbidden.title': 'You cannot open this page',
  'auth.forbidden.body':
    'None of your roles allows this page. If you think that is wrong, ask your company’s administrator.',
  'error.unreachable':
    'The API could not be reached. Check that the server is running, then try again.',
  'error.rateLimited': 'Too many requests from this device. Wait a moment, then try again.',
  'error.unexpected':
    'Something unexpected went wrong. Try again; if it keeps happening, tell your administrator and quote the correlation ID below.',
  'signIn.title': 'Sign in',
  'signIn.intro': 'Use the email and password your administrator gave you.',
  'signIn.email': 'Email',
  'signIn.password': 'Password',
  'signIn.submit': 'Sign in',
  'signIn.working': 'Checking…',
  'signIn.startOver': 'Start over',
  'signIn.code.title': 'Second factor',
  'signIn.code.intro':
    'This account uses two-factor authentication. Enter the code from the authenticator app on your phone.',
  'signIn.code.label': 'Verification code',
  'signIn.code.hint':
    'The 6-digit code from the app, or one of your saved recovery codes (each works once).',
  'signIn.code.submit': 'Verify',
  'signIn.enrol.title': 'Set up two-factor authentication',
  'signIn.enrol.intro':
    'Administrator accounts need a second factor before they can be used. Set it up once, with any authenticator app on your phone.',
  'signIn.enrol.stepScan': 'Open your authenticator app and scan this QR code.',
  'signIn.enrol.stepCode': 'Enter the 6-digit code the app shows, to confirm it worked.',
  'signIn.enrol.qrAlt': 'QR code that adds this account to an authenticator app',
  'signIn.enrol.manual': 'Cannot scan? Type this secret into the app instead:',
  'signIn.enrol.codeHint': 'The 6-digit code the app shows now.',
  'signIn.enrol.submit': 'Turn on and sign in',
  'signIn.recovery.title': 'Keep your recovery codes',
  'signIn.recovery.intro':
    'If your phone is lost or the app will not open, a recovery code works in place of a code from the app — each one once.',
  'signIn.recovery.listLabel': 'Recovery codes',
  'signIn.recovery.warning':
    'These codes are shown this once only. Write them down or print them and keep them somewhere safe before you continue.',
  'signIn.recovery.continue': 'I have saved them — continue',
  'signIn.error.credentials': 'The email or password is not right.',
  'signIn.error.locked':
    'The account is locked for a while after too many wrong attempts. Wait, then try again.',
  'signIn.error.disabled': 'This account has been disabled. Ask your company’s administrator.',
  'signIn.error.code': 'That code is not right. Try the next code the app shows.',
  'signIn.error.expired':
    'This sign-in has timed out. Choose “Start over” and enter your password again.',
  'role.admin': 'Administrator',
  'role.purchasing': 'Purchasing',
  'role.purchasing_approver': 'Purchasing approver',
  'role.plant': 'Plant',
  'role.logistics': 'Logistics',
  'role.branch_manager': 'Branch manager',
  'role.finance': 'Finance',
  'role.admin.description':
    'Manages users, roles, locations and configuration; reopens closed periods.',
  'role.admin.secondFactor': 'Requires two-factor authentication.',
  'role.purchasing.description': 'Creates and sends purchase orders; manages suppliers.',
  'role.purchasing_approver.description': 'Approves purchase orders above the approval threshold.',
  'role.plant.description': 'Receives goods, runs production orders, manages plant stock.',
  'role.logistics.description': 'Dispatches transfers.',
  'role.branch_manager.description':
    'Raises requisitions, receives transfers, counts branch stock.',
  'role.finance.description': 'Views costs, variances and valuation; exports financial data.',
  'users.title': 'Users and roles',
  'users.intro':
    'Everyone who uses the ERP and the roles they hold. A user may hold several roles. Every change is recorded in the audit log.',
  'users.loading': 'Loading users…',
  'users.table.caption': 'Users',
  'users.column.name': 'User',
  'users.column.roles': 'Roles',
  'users.column.mfa': 'Two-factor authentication',
  'users.column.lastSignIn': 'Last sign-in',
  'users.column.actions': 'Actions',
  'users.noRoles': 'No roles yet',
  'users.never': 'Never',
  'users.mfa.on': 'On',
  'users.mfa.off': 'Not used',
  'users.mfa.pending': 'To be set up at next sign-in',
  'users.create.open': 'Add user',
  'users.create.title': 'New user',
  'users.create.submit': 'Create user',
  'users.create.done': 'Created {email}. Give the first password to its owner in person.',
  'users.field.displayName': 'Display name',
  'users.field.email': 'Email',
  'users.field.password': 'First password',
  'users.field.passwordHint':
    'At least 12 characters — a long phrase is easier to remember and harder to guess. Nothing common, and not containing the email.',
  'users.field.locale': 'Language for this user',
  'users.field.roles': 'Roles',
  'users.saving': 'Saving…',
  'users.cancel': 'Cancel',
  'users.roles.editShort': 'Manage roles',
  'users.roles.edit': 'Manage roles of {name}',
  'users.roles.title': 'Roles of {name}',
  'users.roles.intro':
    'Tick to give a role, untick to take it away; it applies from the user’s next request. Someone given the administrator role without a second factor is signed out and must set one up at their next sign-in.',
  'users.roles.legend': 'Roles of {email}',
  'users.roles.granted': 'Gave {role} to {name}.',
  'users.roles.revoked': 'Took {role} from {name}.',
  'users.roles.close': 'Close',
  'users.error.emailTaken': 'A user with this email already exists.',
  'users.error.weakPassword':
    'The password does not meet the policy: at least 12 characters, nothing common, and not containing the email.',
  'users.error.invalid': 'Something is missing or not valid. Check the email, name and password.',
  'users.error.lastAdmin':
    'Not possible: this is the only active administrator. Give the administrator role to someone else first.',

  'notFound.title': 'Page not found',
  'notFound.body': 'The link may be wrong, or the page has moved.',
  'notFound.back': 'Back to system status',
};
