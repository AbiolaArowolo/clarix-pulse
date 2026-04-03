import nodemailer from 'nodemailer';

function smtpReady(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
}

export function accountEmailReady(): boolean {
  return smtpReady();
}

function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function fromAddress() {
  return {
    name: process.env.SMTP_FROM_NAME ?? 'Clarix Pulse',
    address: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'alerts@clarixpulse.local',
  };
}

interface AccountEmailInput {
  to: string;
  companyName: string;
  displayName: string;
  accessKey: string;
  accessKeyExpiresAt: string;
  appUrl: string;
  enabled: boolean;
}

interface PasswordResetEmailInput {
  to: string;
  companyName: string;
  displayName: string;
  resetUrl: string;
  expiresAt: string;
  appUrl: string;
}

export async function sendRegistrationAccessKeyEmail(input: AccountEmailInput): Promise<boolean> {
  if (!smtpReady()) {
    return false;
  }

  const subject = `Clarix Pulse access key for ${input.companyName}`;
  const lines = [
    `Hello ${input.displayName || input.companyName},`,
    '',
    `Welcome to Clarix Pulse.`,
    '',
    `Your account for ${input.companyName} has been created.`,
    `Access key: ${input.accessKey}`,
    `Key expires: ${input.accessKeyExpiresAt}`,
    '',
    input.enabled
      ? 'Your account is enabled. Use your email, password, and this access key to sign in.'
      : 'Your account is pending activation by Clarix. Keep this key safe. Once the account is enabled, use your email, password, and this key to sign in.',
    '',
    `Sign in: ${input.appUrl}/login`,
    '',
    'Clarix Pulse',
  ];

  await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject,
    text: lines.join('\n'),
  });

  return true;
}

interface AccessKeyResendInput {
  to: string;
  companyName: string;
  displayName: string;
  accessKey: string;
  accessKeyExpiresAt: string;
  appUrl: string;
}

export async function sendAccessKeyResendEmail(input: AccessKeyResendInput): Promise<boolean> {
  if (!smtpReady()) {
    return false;
  }

  const subject = `Your Clarix Pulse access key — ${input.companyName}`;
  const lines = [
    `Hello ${input.displayName || input.companyName},`,
    '',
    'You requested your Clarix Pulse access key. A new key has been generated for your workspace.',
    '',
    `Access key: ${input.accessKey}`,
    `Key expires: ${input.accessKeyExpiresAt}`,
    '',
    'Use this key together with your email and password when signing in.',
    '',
    `Sign in: ${input.appUrl}/login`,
    '',
    'If you did not request this, contact your Clarix administrator.',
    '',
    'Clarix Pulse',
  ];

  await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject,
    text: lines.join('\n'),
  });

  return true;
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<boolean> {
  if (!smtpReady()) {
    return false;
  }

  const subject = `Reset your Clarix Pulse password for ${input.companyName}`;
  const lines = [
    `Hello ${input.displayName || input.companyName},`,
    '',
    'A password reset was requested for your Clarix Pulse account.',
    '',
    `Reset link: ${input.resetUrl}`,
    `Link expires: ${input.expiresAt}`,
    '',
    `If you did not request this, ignore this email and sign in at ${input.appUrl}/login.`,
    '',
    'Clarix Pulse',
  ];

  await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject,
    text: lines.join('\n'),
  });

  return true;
}
