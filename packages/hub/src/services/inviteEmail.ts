import nodemailer from 'nodemailer';
import { ctaButton, detailRow, escapeHtml, wrapEmailHtml } from './emailTemplate';

// Reuses the same SMTP_* env vars alerting.ts uses for tenant alert emails
// (see .env.example "Email alerting (SMTP)") -- there is no separate
// transactional-mail configuration yet, so an invite email silently no-ops
// (sent: false) rather than failing the whole invite when SMTP isn't set up.
// The invite row itself is still created either way; the caller is expected
// to also hand the admin a copyable link as a fallback delivery path.
function transporterConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
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

// The invited person hasn't signed up yet, so the only place they can land
// is Clerk's own sign-up widget (RegisterPage.tsx, routing="virtual" at
// /register). Once they sign up with the same email this invite used, the
// existing account-linking logic (resolveOrLinkPulseUserByClerkIdentity)
// links them to the pending row this invite created instead of prompting
// them to create a brand-new workspace.
export function buildInviteSignUpUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/register`;
}

export interface InviteEmailResult {
  sent: boolean;
  reason?: string;
}

export async function sendTeammateInviteEmail(input: {
  toEmail: string;
  toDisplayName: string;
  tenantName: string;
  inviterEmail: string;
  role: string;
  signUpUrl: string;
}): Promise<InviteEmailResult> {
  if (!transporterConfigured()) {
    return { sent: false, reason: 'SMTP is not configured on this server.' };
  }

  const fromAddress = process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'alerts@clarixpulse.local';
  // tenantName/inviterEmail/role are user-controlled free text (a tenant admin
  // sets the workspace name, chooses the invite role) reaching a third-party
  // inbox the sender doesn't control - must be escaped, unlike alerting.ts's
  // emails which only ever go to the tenant's own configured recipients.
  const safeTenantName = escapeHtml(input.tenantName);
  const safeInviterEmail = escapeHtml(input.inviterEmail);
  const safeRole = escapeHtml(input.role);
  const html = wrapEmailHtml(`
    <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a;">You're invited to ${safeTenantName}</h2>
    <p style="margin:0 0 16px;">
      ${safeInviterEmail} invited you to join the <strong>${safeTenantName}</strong> workspace on
      Clarix Pulse as <strong>${safeRole}</strong>.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0">
      ${detailRow('Workspace', safeTenantName)}
      ${detailRow('Role', safeRole)}
      ${detailRow('Invited by', safeInviterEmail)}
    </table>
    ${ctaButton('Accept invite and sign in', input.signUpUrl)}
    <p style="margin:20px 0 0;font-size:12px;color:#64748b;word-break:break-all;">
      If the button does not work, copy this link into your browser: ${input.signUpUrl}
    </p>
  `);

  try {
    await getTransporter().sendMail({
      from: { name: process.env.SMTP_FROM_NAME ?? 'Clarix Pulse', address: fromAddress },
      to: input.toEmail,
      subject: `You're invited to ${input.tenantName} on Clarix Pulse`,
      text: `${input.inviterEmail} invited you to join ${input.tenantName} on Clarix Pulse as ${input.role}. `
        + `Accept your invite: ${input.signUpUrl}`,
      html,
    });
    return { sent: true };
  } catch (err) {
    console.error('[invites] Failed to send invite email:', err);
    return { sent: false, reason: err instanceof Error ? err.message : 'Email delivery failed.' };
  }
}
