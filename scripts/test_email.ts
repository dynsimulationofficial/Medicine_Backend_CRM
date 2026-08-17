import emailService from "../service/EmailService";

async function testEmail() {
  console.log("📧 Verifying SMTP connection...");
  await emailService.verify();
  console.log("✅ SMTP Verification successful!");

  console.log("📩 Sending test OTP email...");
  const info = await emailService.sendOtpEmail("wasiquekhan90@gmail.com", "998877");
  console.log("✅ Test Email sent successfully!", info);
}

testEmail().catch((err) => {
  console.error("❌ Email test failed:", err);
  process.exit(1);
});
