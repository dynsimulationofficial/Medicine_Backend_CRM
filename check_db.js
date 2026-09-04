const { Sequelize, QueryTypes } = require('sequelize');
const dotenv = require('dotenv');
dotenv.config();

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres',
  logging: false,
});

async function main() {
  try {
    const leads = await sequelize.query(`SELECT id, full_name, agent_id, lead_source_id, campaign_id, created_at FROM public.leads WHERE deleted_at IS NULL`, { type: QueryTypes.SELECT });
    console.log("LEADS COUNT:", leads.length);
    console.log("LEADS SAMPLE:", leads);

    const users = await sequelize.query(`SELECT su.id, su.name, su.email, r.name as role FROM public.system_users su LEFT JOIN public.user_role ur ON ur.system_user_id = su.id LEFT JOIN public.roles r ON r.id = ur.role_id WHERE su.deleted_at IS NULL`, { type: QueryTypes.SELECT });
    console.log("USERS:", users);

    const tasks = await sequelize.query(`SELECT id, lead_id, assigned_agent_id, start_at, end_at, status FROM public.lead_tasks WHERE deleted_at IS NULL`, { type: QueryTypes.SELECT });
    console.log("TASKS COUNT:", tasks.length);
    console.log("TASKS SAMPLE:", tasks);
  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}
main();
