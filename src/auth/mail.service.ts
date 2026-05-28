import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { readEnv } from '../config/env';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from = readEnv('SMTP_FROM', 'Old Whale <no-reply@oldwhale.local>');
  private readonly transporter: Transporter | null;

  constructor() {
    const host = readEnv('SMTP_HOST');
    if (!host) {
      this.transporter = null;
      return;
    }

    const port = Number(readEnv('SMTP_PORT', '587'));
    const user = readEnv('SMTP_USER');
    const pass = readEnv('SMTP_PASS');
    this.transporter = nodemailer.createTransport({
      host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      secure: readEnv('SMTP_SECURE', '').toLowerCase() === 'true' || port === 465,
      auth: user && pass ? { user, pass } : undefined,
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

    if (!this.transporter) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('SMTP_HOST is required to send registration OTP emails');
      }
      this.logger.warn(`SMTP is not configured; registration OTP for ${email}: ${otp}`);
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: email,
      subject,
      text,
    });
  }
}
