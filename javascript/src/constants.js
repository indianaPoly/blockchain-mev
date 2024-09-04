/** @format */

import { createLogger, format, transports } from 'winston';

const { combine, timestamp, printf, colorize } = format;

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'black',
  http: 'magenta',
  debug: 'blue',
};

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}] ${message}`;
});

export const logger = createLogger({
  format: combine(timestamp(), logFormat, colorize({ all: true })),
  transports: [new transports.Console()],
});

export const PRIVATE_RELAY = 'https://relay.flashbots.net';
