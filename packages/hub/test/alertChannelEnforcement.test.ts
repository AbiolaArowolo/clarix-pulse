import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSendEmailAlerts, shouldSendTelegramAlerts } from '../src/services/alerting';

test('shouldSendEmailAlerts returns false when email alerts are disabled', () => {
  const allowed = shouldSendEmailAlerts(
    {
      emailEnabled: false,
      emailRecipients: ['ops@example.com'],
    },
    {
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'alerts@example.com',
      SMTP_PASS: 'secret',
    },
  );

  assert.equal(allowed, false);
});

test('shouldSendTelegramAlerts returns false when telegram alerts are disabled', () => {
  const allowed = shouldSendTelegramAlerts(
    {
      telegramEnabled: false,
      telegramChatIds: ['123456'],
    },
    {
      TELEGRAM_BOT_TOKEN: 'telegram-token',
    },
  );

  assert.equal(allowed, false);
});

test('shouldSendEmailAlerts requires recipients and full smtp configuration', () => {
  assert.equal(
    shouldSendEmailAlerts(
      {
        emailEnabled: true,
        emailRecipients: ['ops@example.com'],
      },
      {
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'alerts@example.com',
        SMTP_PASS: 'secret',
      },
    ),
    true,
  );

  assert.equal(
    shouldSendEmailAlerts(
      {
        emailEnabled: true,
        emailRecipients: ['ops@example.com'],
      },
      {
        SMTP_HOST: 'smtp.example.com',
        SMTP_USER: 'alerts@example.com',
      },
    ),
    false,
  );
});
