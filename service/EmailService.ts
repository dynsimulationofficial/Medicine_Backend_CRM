import nodemailer, { Transporter } from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

type SendOptions = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
};

class EmailService {
  private transporter: Transporter;
  private from: string;

  constructor() {
    const host = process.env.SMTP_HOST || "";
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER || "";
    const pass = process.env.SMTP_PASS || "";
    const secure = port === 465; // 465 => SMTPS, 587 => STARTTLS

    if (!host || !user || !pass) {
      throw new Error("[mailer] Missing SMTP envs (SMTP_HOST/USER/PASS).");
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });

    this.from = process.env.SMTP_FROM || `"${process.env.MAIL_FROM_NAME || "LeadCRM"}" <${user}>`;
  }

  /** Call once at app startup to verify SMTP connectivity/auth */
  async verify(): Promise<void> {
    await this.transporter.verify();
    console.log(
      `[mailer] SMTP verified: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT} as ${process.env.SMTP_USER}`
    );
  }

  /** Core mail sender (private helper) */
  private async sendMail(options: SendOptions) {
    const { to, subject, html, text, replyTo } = options;
    if (!html && !text) throw new Error("[mailer] Either html or text is required.");

    const info = await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      html,
      text,
      replyTo,
    });
    console.log("[mailer] Message sent:", info.messageId, info.response || "");
    return info;
  }

  /** OTP email */
  async sendOtpEmail(to: string, otp: string) {
    const subject = "Your Login OTP";
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
        <p>Your OTP to login is <b style="font-size:18px;letter-spacing:2px">${otp}</b>.</p>
        <p>This code will expire in 5 minutes.</p>
        <p style="color:#6b7280;font-size:12px">If you didn’t request this, you can ignore this email.</p>
      </div>
    `;
    const text = `Your OTP to login is ${otp}. It will expire in 5 minutes.`;
    return this.sendMail({ to, subject, html, text });
  }

  /** Admin login notification (with timestamp) */
  async sendAdminLoginNotification(params: {
    adminTo?: string | string[];
    userName: string;
    userEmail: string;
    loginTimeISO?: string;           // ISO string (UTC) optional
    loginTimeLocalLabel?: string;    // e.g., "2025-09-03 14:22 IST"
  }) {
    const { adminTo, userName, userEmail, loginTimeISO, loginTimeLocalLabel } = params;
    const to = adminTo || process.env.ADMIN_NOTIFY_TO || "admin@example.com";
    const subject = "User Login Notification";

    const timeHtml = loginTimeLocalLabel
      ? `<p>Login time: <b>${loginTimeLocalLabel}</b></p>`
      : loginTimeISO
      ? `<p>Login time (UTC): <b>${loginTimeISO}</b></p>`
      : "";

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5">
        <p>User <strong>${userName}</strong> (${userEmail}) has just logged in successfully.</p>
        ${timeHtml}
      </div>
    `;
    const text = `User ${userName} (${userEmail}) logged in successfully.${
      loginTimeLocalLabel ? ` Login time: ${loginTimeLocalLabel}` : loginTimeISO ? ` Login time (UTC): ${loginTimeISO}` : ""
    }`;

    return this.sendMail({ to, subject, html, text });
  }
}

const emailService = new EmailService();
export default emailService;
