import { createLogger, format, transports, Logger } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// Define the file transport for daily log rotation
const dailyRotateFileTransport = new DailyRotateFile({
  filename: 'logs/application-%DATE%.log',
  datePattern: 'YYYY-MM-DD', // Daily log files
  zippedArchive: true, // Compress the log files
  maxSize: '20m', // Max size of a single log file
  maxFiles: '14d', // Keep logs for the last 14 days
  format: format.combine(
    format.timestamp(),
    format.json() // Format log messages as JSON
  ),
});

// Create the logger instance
const logger: Logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json() // Format log messages as JSON
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple() // Colorized and formatted console output
      ),
    }),
    dailyRotateFileTransport
  ],
});

// Export the logger
export default logger;
