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

  /** Admin login notification (with timestamp and role) */
  async sendAdminLoginNotification(params: {
    adminTo?: string | string[];
    userName: string;
    userEmail: string;
    roleName?: string;
    loginTimeISO?: string;
    loginTimeLocalLabel?: string;
  }) {
    const { adminTo, userName, userEmail, roleName, loginTimeISO, loginTimeLocalLabel } = params;
    const to = adminTo || process.env.ADMIN_NOTIFY_TO || "wasiquekhan90@gmail.com";
    const subject = `🔔 Agent Login Alert: ${userName}`;

    const timeString = loginTimeLocalLabel || loginTimeISO || new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f4f6f8; padding: 24px; color: #333;">
        <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); border-top: 4px solid #0284c7;">
          <div style="padding: 24px 28px;">
            <h2 style="margin: 0 0 12px; font-size: 20px; color: #111827;">CRM Agent Login Alert</h2>
            <p style="margin: 0 0 20px; font-size: 14px; color: #4b5563;">An agent has successfully logged into the CRM system.</p>
            
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 20px;">
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px 0; font-weight: 600; color: #6b7280; width: 35%;">Agent Name:</td>
                <td style="padding: 10px 0; font-weight: bold; color: #111827;">${userName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px 0; font-weight: 600; color: #6b7280;">Agent Email:</td>
                <td style="padding: 10px 0; color: #111827;">${userEmail}</td>
              </tr>
              ${roleName ? `
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 10px 0; font-weight: 600; color: #6b7280;">Role:</td>
                <td style="padding: 10px 0; color: #111827;">${roleName}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 10px 0; font-weight: 600; color: #6b7280;">Login Time:</td>
                <td style="padding: 10px 0; color: #111827;"><b>${timeString}</b></td>
              </tr>
            </table>

            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 12px; font-size: 13px; color: #166534;">
              ✅ Authentication completed successfully.
            </div>
          </div>
          <div style="background: #f9fafb; padding: 14px 28px; text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb;">
            Medice CRM Security System
          </div>
        </div>
      </div>
    `;

    const text = `Agent Login Alert\n\nAgent Name: ${userName}\nAgent Email: ${userEmail}\nRole: ${roleName || "Agent"}\nLogin Time: ${timeString}\n`;

    return this.sendMail({ to, subject, html, text });
  }
}

const emailService = new EmailService();
export default emailService;
