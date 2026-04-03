const LOGO_URL = 'https://pulse.clarixtech.com/pulse-icon-512.png';
const HEADER_BG = '#020617';
const FOOTER_BG = '#0f172a';
const BRAND_TEAL = '#14b8a6';

/**
 * Wraps content in the standard Pulse branded HTML email shell.
 * accentColor drives the thin bar below the header (defaults to teal).
 */
export function wrapEmailHtml(content: string, accentColor = BRAND_TEAL): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clarix Pulse</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
  <tr>
    <td align="center" style="padding:24px 8px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0"
             style="max-width:560px;width:100%;background:#ffffff;border-radius:8px;
                    overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">
        <!-- Header -->
        <tr>
          <td style="background:${HEADER_BG};padding:18px 28px;">
            <img src="${LOGO_URL}" width="34" height="34" alt=""
                 style="display:inline-block;vertical-align:middle;border-radius:6px;">
            <span style="display:inline-block;vertical-align:middle;margin-left:10px;
                         color:#ffffff;font-size:17px;font-weight:700;letter-spacing:1px;">
              CLARIX PULSE
            </span>
          </td>
        </tr>
        <!-- Accent bar -->
        <tr>
          <td style="background:${accentColor};height:3px;font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px 28px 24px;color:#1e293b;font-size:15px;line-height:1.6;">
            ${content}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:${FOOTER_BG};padding:14px 28px;border-top:1px solid #1e293b;">
            <p style="margin:0;font-size:12px;color:#64748b;text-align:center;">
              Clarix Pulse &mdash; Broadcast Monitoring &nbsp;&bull;&nbsp;
              <a href="https://pulse.clarixtech.com" style="color:#14b8a6;text-decoration:none;">
                pulse.clarixtech.com
              </a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Renders a key-value detail row for use inside the body table. */
export function detailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;color:#64748b;font-size:13px;white-space:nowrap;
               padding-right:16px;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:600;
               vertical-align:top;">${value}</td>
  </tr>`;
}

/** Renders a CTA button. */
export function ctaButton(label: string, url: string, color = BRAND_TEAL): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
  <tr>
    <td style="background:${color};border-radius:6px;">
      <a href="${url}"
         style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;
                font-weight:700;text-decoration:none;letter-spacing:0.3px;">
        ${label}
      </a>
    </td>
  </tr>
</table>`;
}
