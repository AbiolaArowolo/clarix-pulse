import nodemailer from 'nodemailer';

function smtpReady(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
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
