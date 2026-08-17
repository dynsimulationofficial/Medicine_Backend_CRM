import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { Client } from "pg";

async function createAdmin() {
  const client = new Client({
    host: "127.0.0.1",
    port: 5432,
    user: "postgres",
    password: "123456",
    database: "medicine_crm_db",
  });
  await client.connect();

  const email = "wasiquekhan90@gmail.com";
  const plainPassword = "123123";
  const mobileNumber = "9876543210";
  const name = "Wasiq Khan";

  // Check if user exists
  const existing = await client.query(
    "SELECT id FROM public.system_users WHERE email = $1 AND deleted_at IS NULL",
    [email]
  );

  if (existing.rows.length > 0) {
    console.log("User already exists with ID:", existing.rows[0].id);
    await client.end();
    return;
  }

  const userId = uuidv4();
  const hash = await bcrypt.hash(plainPassword, 10);

  // Insert user
  await client.query(
    `INSERT INTO public.system_users (id, name, mobile_number, email, password, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [userId, name, mobileNumber, email, hash]
  );

  // Assign Admin role
  const adminRoleId = "2a673caa-1dc9-41c2-90f4-154b16f2cb99";
  await client.query(
    `INSERT INTO public.user_role (system_user_id, role_id, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
    [userId, adminRoleId]
  );

  console.log("✅ Admin user created successfully!");
  console.log("Email:", email);
  console.log("User ID:", userId);

  await client.end();
}

createAdmin().catch((err) => {
  console.error("❌ Error creating admin user:", err);
  process.exit(1);
});
