import nodemailer from 'nodemailer';
import { wrapEmailHtml, detailRow, ctaButton } from './emailTemplate';

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

  const text = [
    `Hello ${input.displayName || input.companyName},`,
    '',
    `Welcome to Clarix Pulse.`,
    '',
    `Your account for ${input.companyName} has been created.`,
    `Access key: ${input.accessKey}`,
    `Key expires: ${input.accessKeyExpiresAt}`,
    '',
    'Your account is active. Sign in with your email and password. Keep this access key safe — you can use it as a recovery credential or request a new one from your account settings.',
    '',
    `Sign in: ${input.appUrl}/login`,
    '',
    'Clarix Pulse',
  ].join('\n');

  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#020617;">Welcome to Clarix Pulse</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;">
      Hello ${input.displayName || input.companyName}, your account for
      <strong>${input.companyName}</strong> is ready.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;
                padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;
                text-transform:uppercase;letter-spacing:0.5px;">Access Key</p>
      <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;
                font-family:monospace;letter-spacing:1px;">${input.accessKey}</p>
      <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;">Expires: ${input.accessKeyExpiresAt}</p>
    </div>
    <p style="margin:0 0 20px;font-size:13px;color:#475569;">
      Keep this key safe — use it as a recovery credential if you ever need to reset access,
      or request a new one from your account settings at any time.
    </p>
    ${ctaButton('Sign In to Pulse', `${input.appUrl}/login`)}
  `);

  await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject,
    text,
    html,
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

  const text = [
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
  ].join('\n');

  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#020617;">Your New Access Key</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;">
      Hello ${input.displayName || input.companyName}, a new access key has been generated
      for <strong>${input.companyName}</strong>.
    </p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;
                padding:16px 20px;margin-bottom:20px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#94a3b8;
                text-transform:uppercase;letter-spacing:0.5px;">Access Key</p>
      <p style="margin:0;font-size:16px;font-weight:700;color:#0f172a;
                font-family:monospace;letter-spacing:1px;">${input.accessKey}</p>
      <p style="margin:6px 0 0;font-size:12px;color:#94a3b8;">Expires: ${input.accessKeyExpiresAt}</p>
    </div>
    <p style="margin:0 0 20px;font-size:13px;color:#475569;">
      If you did not request this key, contact your Clarix administrator immediately.
    </p>
    ${ctaButton('Sign In to Pulse', `${input.appUrl}/login`)}
  `);

  await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject,
    text,
    html,
  });

  return true;
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<boolean> {
  if (!smtpReady()) {
    return false;
  }

  const subject = `Reset your Clarix Pulse password for ${input.companyName}`;

  const text = [
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
  ].join('\n');

  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 8px;font-size:20px;color:#020617;">Password Reset</h2>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;">
      Hello ${input.displayName || input.companyName}, a password reset was requested
      for your Clarix Pulse account at <strong>${input.companyName}</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-collapse:collapse;margin-bottom:20px;">
      ${detailRow('Link expires', input.expiresAt)}
    </table>
    ${ctaButton('Reset My Password', input.resetUrl, '#dc2626')}
    <p style="margin:20px 0 0;font-size:12px;color:#94a3b8;">
      If you did not request this, you can safely ignore this email.
      Your password has not been changed.
    </p>
  `, '#dc2626');

  await transporter().sendMail({
    from: fromAddress(),
    to: input.to,
    subject,
    text,
    html,
  });

  return true;
}
