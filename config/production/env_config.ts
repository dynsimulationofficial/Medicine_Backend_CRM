// Define the path to the secrets file
const secretFilePath = "/tmp/orizon_dev_postgresql";
import fs from "fs";

if (fs.existsSync(secretFilePath)) {
  try {
    const secrets = fs.readFileSync(secretFilePath, "utf8");
    const config = JSON.parse(secrets);

    // Set the environment variables
    process.env.NODE_ENV = "Production";
    process.env.SYSTEMUSER_PORT = config.SYSTEMUSER_PORT;
    process.env.SENTRY_DSN = config.SENTRY_DSN;
    process.env.PGHOST_WRITER = config.PGHOST_WRITER;
    process.env.PGPORT_WRITER = config.PGPORT_WRITER;
    process.env.PGDATABASE_WRITER = config.PGDATABASE_WRITER;
    process.env.PGUSER_WRITER = config.PGUSER_WRITER;
    process.env.PGPASSWORD_WRITER = config.PGPASSWORD_WRITER;
    process.env.PGMAXCONNECTIONS_WRITER = config.PGMAXCONNECTIONS_WRITER;
    process.env.PGMINCONNECTIONS_WRITER = config.PGMINCONNECTIONS_WRITER;
    process.env.PGIDLETIMEOUTMILLIS_WRITER = config.PGIDLETIMEOUTMILLIS_WRITER;
    process.env.PGCONNECTIONTIMEOUTMILLIS_WRITER =
      config.PGCONNECTIONTIMEOUTMILLIS_WRITER;
    process.env.PGHOST_READER = config.PGHOST_READER;
    process.env.PGPORT_READER = config.PGPORT_READER;
    process.env.PGDATABASE_READER = config.PGDATABASE_READER;
    process.env.PGUSER_READER = config.PGUSER_READER;
    process.env.PGPASSWORD_READER = config.PGPASSWORD_READER;
    process.env.PGMAXCONNECTIONS_READER = config.PGMAXCONNECTIONS_READER;
    process.env.PGMINCONNECTIONS_READER = config.PGMINCONNECTIONS_READER;
    process.env.PGIDLETIMEOUTMILLIS_READER = config.PGIDLETIMEOUTMILLIS_READER;
    process.env.PGCONNECTIONTIMEOUTMILLIS_READER =
      config.PGCONNECTIONTIMEOUTMILLIS_READER;
  } catch (err) {
    console.error("Error reading or parsing the secrets file:", err);
  }
} else {
  console.warn("Secrets file not found, using default or .env configurations");
}
