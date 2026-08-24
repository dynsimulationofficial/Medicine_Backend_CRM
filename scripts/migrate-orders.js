const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.PGDATABASE_WRITER || process.env.DB_NAME || 'medicine_crm_db',
  process.env.PGUSER_WRITER || process.env.DB_USER || 'postgres',
  process.env.PGPASSWORD_WRITER || process.env.DB_PASSWORD || 'root',
  {
    host: process.env.PGHOST_WRITER || process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.PGPORT_WRITER || process.env.DB_PORT) || 5432,
    dialect: 'postgres',
    logging: console.log,
  }
);

async function runMigration() {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to Staging Database');

    await sequelize.query(`
      -- 1. Sequence for Order Number
      CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START 1;

      -- 2. Lead Orders Table
      CREATE TABLE IF NOT EXISTS public.lead_orders (
          id UUID PRIMARY KEY,
          order_number VARCHAR(50) NOT NULL UNIQUE DEFAULT ('ORD' || to_char(nextval('public.order_number_seq'), 'FM000000')),
          lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
          agent_id UUID NULL,
          total_items INTEGER NOT NULL DEFAULT 0,
          grand_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
          order_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
          payment_status VARCHAR(50) NOT NULL DEFAULT 'Pending',
          payment_mode VARCHAR(50) NOT NULL DEFAULT 'COD',
          courier_name VARCHAR(100) NULL,
          tracking_number VARCHAR(100) NULL,
          order_notes TEXT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          deleted_at TIMESTAMP WITH TIME ZONE NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_orders_lead_id ON public.lead_orders(lead_id);
      CREATE INDEX IF NOT EXISTS idx_lead_orders_order_status ON public.lead_orders(order_status);

      -- 3. Lead Order Items Table
      CREATE TABLE IF NOT EXISTS public.lead_order_items (
          id UUID PRIMARY KEY,
          order_id UUID NOT NULL REFERENCES public.lead_orders(id) ON DELETE CASCADE,
          lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
          medicine_name VARCHAR(255) NOT NULL,
          unit VARCHAR(50) DEFAULT 'Strip',
          quantity INTEGER NOT NULL DEFAULT 1,
          rate NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
          total_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          deleted_at TIMESTAMP WITH TIME ZONE NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lead_order_items_order_id ON public.lead_order_items(order_id);
      CREATE INDEX IF NOT EXISTS idx_lead_order_items_lead_id ON public.lead_order_items(lead_id);
    `);

    console.log('🎉 Staging Database Schema migration completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
