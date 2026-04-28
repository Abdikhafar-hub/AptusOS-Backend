const env = require('../config/env');
const logger = require('../config/logger');

let ResendClient = null;
try {
  ({ Resend: ResendClient } = require('resend'));
} catch (error) {
  ResendClient = null;
}

const APP_NAME = env.appName;
const DEFAULT_LOGIN_URL = `${env.frontendAppUrl}/login`;
const supportLine = env.resend.supportEmail ? `Need help? Contact ${env.resend.supportEmail}.` : null;
const resendFrom = `${env.resend.fromName} <${env.resend.fromEmail}>`;

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const resolveProviderError = (error, fallback) => {
  const message = error?.message || error?.name || fallback;
  return String(message).slice(0, 300);
};

const createResend = () => {
  if (!ResendClient || env.email.defaultProvider !== 'resend' || !env.resend.apiKey) return null;
  return new ResendClient(env.resend.apiKey);
};

const wrapEmailBody = ({ heading, intro, contentHtml, outro }) => `
  <div style="font-family:Arial,Helvetica,sans-serif;line-height:1.6;color:#0f172a">
    <p>${intro}</p>
    <h2 style="margin-top:24px;margin-bottom:12px">${heading}</h2>
    ${contentHtml}
    <p style="margin-top:20px">${outro}</p>
    <p>Regards,<br/>${APP_NAME} Team</p>
  </div>
`;

const emailService = {
  async sendEmail({ to, subject, html, text }) {
    const resend = createResend();

    if (!resend) {
      const errorMessage = 'Email provider is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.';
      logger.warn({ to, subject }, errorMessage);
      return { sent: false, error: errorMessage };
    }

    try {
      const response = await resend.emails.send({
        from: resendFrom,
        to,
        subject,
        html,
        text
      });

      if (response?.error) {
        const errorMessage = resolveProviderError(response.error, 'Email provider rejected the message.');
        logger.warn({ to, subject, error: errorMessage }, 'Email send failed');
        return { sent: false, error: errorMessage };
      }

      return { sent: true, provider: 'resend', id: response?.data?.id || null };
    } catch (error) {
      const errorMessage = resolveProviderError(error, 'Email provider request failed.');
      logger.warn({ to, subject, error: errorMessage }, 'Email send failed');
      return { sent: false, error: errorMessage };
    }
  },

  async sendStaffOnboardingCredentialsEmail({ to, firstName, email, temporaryPassword, loginUrl = DEFAULT_LOGIN_URL }) {
    const subject = `Welcome to ${APP_NAME} - Your account is ready`;
    const intro = `Hello ${escapeHtml(firstName || 'there')},`;
    const contentHtml = `
      <p>Welcome to ${APP_NAME}. Your staff profile has been created and you can sign in immediately.</p>
      <p><strong>Login URL</strong><br/><a href="${escapeHtml(loginUrl)}">${escapeHtml(loginUrl)}</a></p>
      <p><strong>Work email</strong><br/>${escapeHtml(email)}</p>
      <p><strong>Temporary password</strong><br/>${escapeHtml(temporaryPassword)}</p>
      <p><strong>First login instructions:</strong></p>
      <ol>
        <li>Open the login page from the URL above.</li>
        <li>Use your work email and temporary password to sign in.</li>
        <li>Set a new password when prompted.</li>
      </ol>
      <p><strong>Keep this message private and do not share your password.</strong></p>
      ${supportLine ? `<p>${escapeHtml(supportLine)}</p>` : ''}
    `;
    const text = [
      `Hello ${firstName || 'there'},`,
      '',
      `Welcome to ${APP_NAME}. Your staff profile has been created and you can sign in immediately.`,
      '',
      'Login URL',
      loginUrl,
      '',
      'Work email',
      email,
      '',
      'Temporary password',
      temporaryPassword,
      '',
      'First login instructions:',
      '1. Open the login page from the URL above.',
      '2. Use your work email and temporary password to sign in.',
      '3. Set a new password when prompted.',
      '',
      'Keep this message private and do not share your password.',
      supportLine || '',
      '',
      `Regards,`,
      `${APP_NAME} Team`
    ].filter(Boolean).join('\n');

    return this.sendEmail({
      to,
      subject,
      html: wrapEmailBody({
        heading: `Welcome to ${APP_NAME}`,
        intro,
        contentHtml,
        outro: 'For security, please update your password immediately after your first login.'
      }),
      text
    });
  },

  async sendPasswordResetEmail({ to, firstName, resetToken }) {
    const subject = 'Reset your AptusOS password';
    const intro = `Hello ${escapeHtml(firstName || 'there')},`;
    const contentHtml = `
      <p>Use the reset token below to complete your password reset:</p>
      <p><strong>${escapeHtml(resetToken)}</strong></p>
      <p>If you did not request this, please ignore this email.</p>
      ${supportLine ? `<p>${escapeHtml(supportLine)}</p>` : ''}
    `;
    const text = [
      `Hello ${firstName || 'there'},`,
      '',
      'Use the reset token below to complete your password reset:',
      resetToken,
      '',
      'If you did not request this, please ignore this email.',
      supportLine || '',
      '',
      `Regards,`,
      `${APP_NAME} Team`
    ].filter(Boolean).join('\n');

    return this.sendEmail({
      to,
      subject,
      html: wrapEmailBody({
        heading: 'Password reset',
        intro,
        contentHtml,
        outro: 'Your account security is important to us.'
      }),
      text
    });
  },

  async sendApprovalNotificationEmail({ to, title, body }) {
    return this.sendEmail({
      to,
      subject: 'Approval request pending',
      html: wrapEmailBody({
        heading: 'Approval notification',
        intro: 'Hello,',
        contentHtml: `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body || '')}</p>`,
        outro: 'Please review it in AptusOS.'
      }),
      text: `Approval request pending\n\n${title}\n${body || ''}`
    });
  },

  async sendTaskAssignedEmail({ to, title, body }) {
    return this.sendEmail({
      to,
      subject: 'New AptusOS task assigned',
      html: wrapEmailBody({
        heading: 'Task assigned',
        intro: 'Hello,',
        contentHtml: `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body || '')}</p>`,
        outro: 'Please check your dashboard for full task details.'
      }),
      text: `New AptusOS task assigned\n\n${title}\n${body || ''}`
    });
  },

  async sendDocumentExpiryEmail({ to, title, expiryDate }) {
    return this.sendEmail({
      to,
      subject: 'Document expiry reminder',
      html: wrapEmailBody({
        heading: 'Document expiry reminder',
        intro: 'Hello,',
        contentHtml: `<p>${escapeHtml(title)} is approaching expiry${expiryDate ? ` on ${escapeHtml(expiryDate)}.` : '.'}</p>`,
        outro: 'Please review and update the document in AptusOS.'
      }),
      text: `Document expiry reminder\n\n${title} is approaching expiry${expiryDate ? ` on ${expiryDate}.` : '.'}`
    });
  },

  // Backward compatibility for older template-style callers.
  async send(to, templateName, payload = {}) {
    if (templateName === 'passwordReset') {
      return this.sendPasswordResetEmail({
        to,
        firstName: payload.name,
        resetToken: payload.resetToken
      });
    }

    if (templateName === 'accountSetup') {
      return this.sendStaffOnboardingCredentialsEmail({
        to,
        firstName: payload.name,
        email: payload.email,
        temporaryPassword: payload.temporaryPassword,
        loginUrl: payload.loginUrl || DEFAULT_LOGIN_URL
      });
    }

    return this.sendEmail({
      to,
      subject: payload.subject || `${APP_NAME} notification`,
      html: payload.html || `<p>${escapeHtml(payload.text || '')}</p>`,
      text: payload.text || ''
    });
  }
};

module.exports = emailService;
