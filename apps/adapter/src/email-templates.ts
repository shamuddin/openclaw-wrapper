import { env } from './env.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildWorkspaceInviteEmail(params: {
  workspaceName: string;
  inviterName: string;
  recipientEmail: string;
  token: string;
}) {
  const inviteUrl = `${env.APP_BASE_URL}/?invite=${encodeURIComponent(params.token)}`;
  const subject = `You're invited to ${params.workspaceName}`;
  const textBody = [
    `${params.inviterName} invited ${params.recipientEmail} to join ${params.workspaceName} in OpenClaw Wrapper.`,
    '',
    `If you already have an account for ${params.recipientEmail}, sign in and the invite will be applied automatically.`,
    'If you need to create a new account, open this link:',
    inviteUrl,
    '',
    `Or paste this invite token into the sign-in screen: ${params.token}`,
  ].join('\n');

  const htmlBody = `
    <p><strong>${escapeHtml(params.inviterName)}</strong> invited <strong>${escapeHtml(params.recipientEmail)}</strong> to join <strong>${escapeHtml(params.workspaceName)}</strong> in OpenClaw Wrapper.</p>
    <p>If you already have an account for this email, sign in and the invite will be applied automatically.</p>
    <p>If you need to create a new account, use this link:</p>
    <p><a href="${escapeHtml(inviteUrl)}">${escapeHtml(inviteUrl)}</a></p>
    <p>Or paste this invite token into the sign-in screen:</p>
    <pre>${escapeHtml(params.token)}</pre>
  `.trim();

  return {
    subject,
    textBody,
    htmlBody,
    inviteUrl,
  };
}

export function buildPasswordResetEmail(params: {
  recipientEmail: string;
  token: string;
}) {
  const resetUrl = `${env.APP_BASE_URL}/?reset=${encodeURIComponent(params.token)}`;
  const subject = 'Reset your OpenClaw Wrapper password';
  const textBody = [
    `A password reset was requested for ${params.recipientEmail}.`,
    '',
    'Use this link to set a new password:',
    resetUrl,
    '',
    `Or paste this reset token into the sign-in screen: ${params.token}`,
    '',
    'This token expires in 1 hour.',
  ].join('\n');

  const htmlBody = `
    <p>A password reset was requested for <strong>${escapeHtml(params.recipientEmail)}</strong>.</p>
    <p>Use this link to set a new password:</p>
    <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
    <p>Or paste this reset token into the sign-in screen:</p>
    <pre>${escapeHtml(params.token)}</pre>
    <p>This token expires in 1 hour.</p>
  `.trim();

  return {
    subject,
    textBody,
    htmlBody,
    resetUrl,
  };
}
