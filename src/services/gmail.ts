import QRCode from 'qrcode';
import { Scholar } from '../types';
import { getAccessToken, getCurrentUser, invalidateAccessToken } from './googleAuth';
import { formatScholarName, personalizeEmailTemplate } from '../utils/formatters';

export interface EmailAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  base64Data: string;
}

export interface SendEmailOptions {
  scholar: Scholar;
  subject: string;
  body: string;
  senderName?: string;
  senderEmail?: string;
  attachments?: EmailAttachment[];
}

export interface SendResult {
  scholarId: string;
  studentId: string;
  email: string;
  success: boolean;
  messageId?: string;
  error?: string;
}

export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Formats byte size into a human-readable label.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Reads a browser File into an EmailAttachment with base64 data.
 */
export function fileToEmailAttachment(file: File): Promise<EmailAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error(`Failed to read file "${file.name}"`));
        return;
      }
      const commaIdx = result.indexOf(',');
      const base64Data = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve({
        id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        base64Data,
      });
    };
    reader.onerror = () => reject(new Error(`Error reading file "${file.name}"`));
    reader.readAsDataURL(file);
  });
}

/**
 * Generates a PNG data URL for the scholar's unique QR code token.
 */
export async function generateQrPngDataUrl(qrToken: string): Promise<string> {
  return await QRCode.toDataURL(qrToken, {
    width: 320,
    margin: 2,
    color: {
      dark: '#004ACD',
      light: '#FFFFFF',
    },
    errorCorrectionLevel: 'H',
  });
}

/**
 * Encodes a Uint8Array or ASCII/UTF-8 string into Base64 safely in chunks.
 */
function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x2000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...sub));
  }
  return btoa(chunks.join(''));
}

/**
 * Encodes a UTF-8 string into standard Base64.
 */
function encodeUtf8Base64(str: string): string {
  return bytesToBase64(new TextEncoder().encode(str));
}

/**
 * Wraps base64 string into 76-character CRLF lines per RFC 2045.
 */
function chunkBase64(b64: string): string {
  const clean = b64.replace(/[\r\n]/g, '');
  const lines: string[] = [];
  for (let i = 0; i < clean.length; i += 76) {
    lines.push(clean.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

/**
 * Encodes a string into Base64URL (RFC 4648 § 5) format required by Gmail API.
 */
function encodeBase64Url(str: string): string {
  return encodeUtf8Base64(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Encodes a header value (e.g. Subject, From) using RFC 2047 MIME encoded-word syntax for full UTF-8 safety.
 */
function encodeMimeWord(str: string): string {
  return `=?utf-8?B?${encodeUtf8Base64(str)}?=`;
}

/**
 * Formats a safe MIME parameter filename value.
 */
function formatMimeFilename(name: string): string {
  const isPrintableAscii = /^[\x20-\x7E]+$/.test(name);
  if (isPrintableAscii) {
    return name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
  return encodeMimeWord(name);
}

/**
 * Generates a styled, branded HTML email message for the scholar attendance pass.
 */
function buildHtmlBody(scholar: Scholar, customBodyText: string): string {
  // Convert newlines in custom text to HTML paragraphs / breaks
  const formattedCustomText = customBodyText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin: 0 0 12px 0; line-height: 1.6; color: #334155; font-size: 14px;">${p}</p>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MIDSA Official Digital Attendance Pass</title>
</head>
<body style="margin: 0; padding: 24px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 74, 205, 0.08); border: 1px solid #e2e8f0;">
    <!-- Association Banner Header -->
    <tr>
      <td style="background: linear-gradient(135deg, #004ACD 0%, #0165CB 100%); padding: 32px 28px; text-align: center; color: #ffffff;">
        <div style="display: inline-block; background-color: #ffffff; border-radius: 12px; padding: 6px 12px; margin-bottom: 12px;">
          <span style="color: #004ACD; font-weight: 900; font-size: 18px; letter-spacing: 1px;">MIDSA</span>
        </div>
        <h1 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">MSU-IIT DOST-SEI Scholars' Association</h1>
        <p style="margin: 0; font-size: 12px; color: #00F7FF; font-weight: 600; text-transform: uppercase; letter-spacing: 1.5px;">Official Digital Attendance Pass</p>
      </td>
    </tr>

    <!-- Body Content -->
    <tr>
      <td style="padding: 28px 28px 16px 28px;">
        <div style="background-color: #f8fafc; border-left: 4px solid #004ACD; padding: 14px 16px; border-radius: 6px; margin-bottom: 24px;">
          <span style="font-size: 11px; font-weight: 700; color: #004ACD; text-transform: uppercase; letter-spacing: 0.5px;">Recipient</span>
          <h2 style="margin: 4px 0 0 0; font-size: 18px; font-weight: 700; color: #0f172a;">${formatScholarName(scholar)}</h2>
          <p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b; font-family: monospace;">Student ID: ${scholar.student_id}</p>
        </div>

        <!-- Custom message from organizer -->
        <div style="margin-bottom: 24px;">
          ${formattedCustomText}
        </div>

        <!-- Digital Pass Card Box -->
        <div style="background: linear-gradient(180deg, #004ACD 0%, #0165CB 100%); border-radius: 14px; padding: 24px; text-align: center; color: #ffffff; border: 2px solid #00F7FF; margin-bottom: 24px;">
          <div style="background-color: #ffffff; border-radius: 12px; padding: 16px; display: inline-block; box-shadow: 0 4px 12px rgba(0,0,0,0.15); margin-bottom: 14px;">
            <!-- Embedded inline QR image via CID -->
            <img src="cid:midsa_qr_pass" alt="Attendance QR Code" width="190" height="190" style="display: block; margin: 0 auto; border: 0;" />
          </div>

          <div style="background-color: rgba(0, 0, 0, 0.25); border-radius: 20px; display: inline-block; padding: 4px 14px; margin-bottom: 12px;">
            <code style="color: #00F7FF; font-size: 12px; font-weight: 700; letter-spacing: 1px; font-family: monospace;">${scholar.qr_code}</code>
          </div>

          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 10px; font-size: 12px; text-align: left; background-color: rgba(0, 0, 0, 0.2); border-radius: 8px; padding: 10px;">
            <tr>
              <td style="color: #bfdbfe; padding: 3px 6px; width: 110px;">Year & Program:</td>
              <td style="color: #ffffff; font-weight: 600; padding: 3px 6px;">${scholar.year_program}</td>
            </tr>
            <tr>
              <td style="color: #bfdbfe; padding: 3px 6px;">College:</td>
              <td style="color: #ffffff; font-weight: 600; padding: 3px 6px;">${scholar.college}</td>
            </tr>
          </table>
        </div>

        <!-- Instructions Box -->
        <div style="background-color: #eff6ff; border: 1px dashed #0165CB; border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;">
          <h4 style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #004ACD;">How to use your pass:</h4>
          <ol style="margin: 0; padding-left: 20px; font-size: 12px; color: #334155; line-height: 1.6;">
            <li>Keep this email accessible on your smartphone or save the attached pass image.</li>
            <li>Present the QR code at the check-in camera terminal upon entering MIDSA events.</li>
            <li>The system will register your attendance instantly.</li>
          </ol>
        </div>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 28px; text-align: center;">
        <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
          This official attendance pass was generated for <strong>${formatScholarName(scholar)}</strong> by the MSU-IIT DOST-SEI Scholars' Association (MIDSA).<br/>
          Please do not share your individual QR code with other students.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Constructs an RFC 2822 MIME message string containing HTML, an embedded QR PNG, and optional file attachments.
 */
async function buildMimeMessage(options: SendEmailOptions): Promise<string> {
  const {
    scholar,
    subject,
    body,
    senderName = 'MIDSA Attendance Office',
    senderEmail,
    attachments = [],
  } = options;

  // Generate QR Code PNG Base64 data
  const qrDataUrl = await generateQrPngDataUrl(scholar.qr_code);
  const qrBase64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');

  const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const relatedBoundary = `boundary_rel_${uniqueSuffix}`;
  const mixedBoundary = `boundary_mix_${uniqueSuffix}`;

  const cleanSenderEmail = senderEmail?.trim();
  const cleanRecipientEmail = (scholar.email || '').trim();
  if (!cleanRecipientEmail || !cleanRecipientEmail.includes('@')) {
    throw new Error(`Scholar ${scholar.student_id} has an invalid or missing email address.`);
  }

  const fromHeader = cleanSenderEmail
    ? `${encodeMimeWord(senderName)} <${cleanSenderEmail}>`
    : encodeMimeWord(senderName);
  const toHeader = `${encodeMimeWord(formatScholarName(scholar))} <${cleanRecipientEmail}>`;
  const subjectHeader = encodeMimeWord(subject);

  const htmlContent = buildHtmlBody(scholar, body);
  const htmlBase64 = chunkBase64(encodeUtf8Base64(htmlContent));

  const relatedParts = [
    `--${relatedBoundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    '',
    htmlBase64,
    '',
    `--${relatedBoundary}`,
    `Content-Type: image/png; name="midsa-pass-${scholar.student_id}.png"`,
    `Content-Transfer-Encoding: base64`,
    `Content-Disposition: inline; filename="midsa-pass-${scholar.student_id}.png"`,
    `Content-ID: <midsa_qr_pass>`,
    '',
    chunkBase64(qrBase64Data),
    '',
    `--${relatedBoundary}--`,
  ];

  if (!attachments || attachments.length === 0) {
    const mimeParts = [
      `From: ${fromHeader}`,
      `To: ${toHeader}`,
      `Subject: ${subjectHeader}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
      '',
      ...relatedParts,
    ];
    return mimeParts.join('\r\n');
  }

  const attachmentParts: string[] = [];
  for (const att of attachments) {
    const safeName = formatMimeFilename(att.name);
    const rawType = (att.mimeType || 'application/octet-stream').split(';')[0].trim();
    const mimeType = /^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(rawType)
      ? rawType
      : 'application/octet-stream';
    attachmentParts.push(
      `--${mixedBoundary}`,
      `Content-Type: ${mimeType}; name="${safeName}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${safeName}"`,
      '',
      chunkBase64(att.base64Data),
      ''
    );
  }

  const mimeParts = [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    `Subject: ${subjectHeader}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
    '',
    ...relatedParts,
    '',
    ...attachmentParts,
    `--${mixedBoundary}--`,
  ];

  return mimeParts.join('\r\n');
}

/**
 * Sends a single email pass to a scholar using the authenticated user's Gmail account.
 */
export async function sendScholarEmailPass(options: SendEmailOptions): Promise<SendResult> {
  const token = await getAccessToken();
  if (!token) {
    return {
      scholarId: options.scholar.id,
      studentId: options.scholar.student_id,
      email: options.scholar.email,
      success: false,
      error: 'Google session expired or not connected. Please click "Sign in with Google" to connect your Gmail account.',
    };
  }

  const user = getCurrentUser();
  const effectiveSenderEmail = options.senderEmail || user?.email || undefined;
  const effectiveSenderName = options.senderName || user?.displayName || 'MIDSA Attendance Office';

  try {
    const rawMime = await buildMimeMessage({
      ...options,
      senderName: effectiveSenderName,
      senderEmail: effectiveSenderEmail,
    });

    // For payloads under 3 MB, use standard JSON raw endpoint; for larger attachments use Gmail media upload
    let response: Response;
    if (rawMime.length < 3 * 1024 * 1024) {
      const base64UrlMessage = encodeBase64Url(rawMime);
      response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: base64UrlMessage,
        }),
      });
    } else {
      response = await fetch(
        'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'message/rfc822',
          },
          body: rawMime,
        }
      );
    }

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const apiMsg = errJson?.error?.message || `Gmail API Error (${response.status})`;
      if (response.status === 401) {
        invalidateAccessToken();
        throw new Error(
          'Your Google authorization token expired or is invalid (401). Please click "Sign in with Google" to reconnect.'
        );
      }
      if (response.status === 403) {
        throw new Error(
          `Gmail send permission denied (403): ${apiMsg}. Please reconnect Google and allow the "Send email on your behalf" permission.`
        );
      }
      throw new Error(apiMsg);
    }

    const data = await response.json();
    return {
      scholarId: options.scholar.id,
      studentId: options.scholar.student_id,
      email: options.scholar.email,
      success: true,
      messageId: data.id,
    };
  } catch (error: any) {
    return {
      scholarId: options.scholar.id,
      studentId: options.scholar.student_id,
      email: options.scholar.email,
      success: false,
      error: error.message || 'Unknown sending failure',
    };
  }
}

/**
 * Dispatches emails to multiple scholars with rate limiting and progress updates.
 */
export async function sendBatchScholarEmailPasses(
  scholars: Scholar[],
  template: { subject: string; body: string; senderName?: string; attachments?: EmailAttachment[] },
  onProgress?: (current: number, total: number, lastResult: SendResult) => void
): Promise<SendResult[]> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Please sign in with Google to send real emails.');
  }

  const user = getCurrentUser();
  const results: SendResult[] = [];

  for (let i = 0; i < scholars.length; i++) {
    const scholar = scholars[i];

    // Personalize subject and body variables using comprehensive token engine
    const personalizedSubject = personalizeEmailTemplate(template.subject, scholar);
    const personalizedBody = personalizeEmailTemplate(template.body, scholar);

    const result = await sendScholarEmailPass({
      scholar,
      subject: personalizedSubject,
      body: personalizedBody,
      senderName: template.senderName,
      senderEmail: user?.email || undefined,
      attachments: template.attachments,
    });

    results.push(result);
    if (onProgress) {
      onProgress(i + 1, scholars.length, result);
    }

    // Gentle pacing between emails (250ms) to respect Gmail API quotas
    if (i < scholars.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return results;
}
