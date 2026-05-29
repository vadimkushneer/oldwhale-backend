import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { readEnv } from '../config/env';
import { EmailDeliveryLogService } from './email-delivery-log.service';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from = readEnv('SMTP_FROM', 'Old Whale <no-reply@oldwhale.local>');
  private readonly host = readEnv('SMTP_HOST');
  private readonly port: number;
  private readonly secure: boolean;
  private readonly authConfigured: boolean;
  private readonly transporter: Transporter | null;

  constructor(private readonly emailLogs: EmailDeliveryLogService) {
    const rawPort = Number(readEnv('SMTP_PORT', '587'));
    this.port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 587;
    this.secure =
      readEnv('SMTP_SECURE', '').toLowerCase() === 'true' || this.port === 465;
    const user = readEnv('SMTP_USER');
    const pass = readEnv('SMTP_PASS');
    this.authConfigured = Boolean(user && pass);

    if (!this.host) {
      this.transporter = null;
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: this.host,
      port: this.port,
      secure: this.secure,
      auth: this.authConfigured ? { user, pass } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  async sendRegistrationOtp(email: string, otp: string, expiresInSeconds: number): Promise<void> {
    const minutes = Math.max(1, Math.ceil(expiresInSeconds / 60));
    const subject = 'Old Whale registration code';
    const text = [
      `Your Old Whale registration code is ${otp}.`,
      `It expires in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      'If you did not request this code, ignore this email.',
    ].join('\n');

    const logUid = this.emailLogs.createAttempt({
      purpose: 'registration_otp',
      recipient: email,
      sender: this.from,
      subject,
      smtpHost: this.host || undefined,
      smtpPort: this.host ? this.port : undefined,
      smtpSecure: this.secure,
      smtpAuthConfigured: this.authConfigured,
    });

    if (!this.transporter) {
      if (process.env.NODE_ENV === 'production') {
        this.emailLogs.complete(logUid, {
          status: 'failed',
          error: new Error('SMTP_HOST is required to send registration OTP emails'),
        });
        throw new Error('SMTP_HOST is required to send registration OTP emails');
      }
      this.logger.warn(`SMTP is not configured; registration OTP for ${email}: ${otp}`);
      this.emailLogs.complete(logUid, { status: 'logged_to_console' });
      return;
    }

    try {
      const result = await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject,
        text,
      });
      this.emailLogs.complete(logUid, {
        status: 'accepted_by_smtp',
        messageId: result.messageId,
        envelope: result.envelope,
        accepted: result.accepted,
        rejected: result.rejected,
        pending: result.pending,
        response: result.response,
      });
      this.logger.log(
        `Registration OTP email accepted by SMTP for ${email}; messageId=${result.messageId ?? 'n/a'} response=${result.response ?? 'n/a'}`,
      );
    } catch (error) {
      this.emailLogs.complete(logUid, { status: 'failed', error });
      this.logger.error(
        `Registration OTP email failed for ${email}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
