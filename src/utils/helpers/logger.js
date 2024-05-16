const { EmbedBuilder, WebhookClient } = require("discord.js");
const pino = require('pino')
const today = new Date();

// Send error webhook
const webhookLogger = process.env.ERROR_LOGS ? new WebhookClient({ url: process.env.ERROR_LOGS }) : undefined;

// Send warn webhook
const sendWarnhook = process.env.ERROR_LOGS ? new WebhookClient({ url: process.env.WARN_LOGS }) : undefined;

// Create logger
const pinoLogger = pino.default(
  {
    level: "debug",
  },
  pino.multistream([
    {
      level: "info",
      stream: pino.transport({
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "yyyy-mm-dd HH:mm:ss",
          ignore: "pid,hostname",
          singleLine: false,
          hideObject: true,
          customColors: "info:blue,warn:yellow,error:red",
        },
      }),
    },
    {
      level: "debug",
      stream: pino.destination({
        dest: `${process.cwd()}/logs/combined-${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}.log`,
        sync: true,
        mkdir: true,
      }),
    },
  ])
);

// Send error webhook
function sendWebhook(content, err) {
  if (!content && !err) return;
  const errString = err?.stack || err;

  const embed = new EmbedBuilder().setColor("DarkRed").setAuthor({ name: err?.name || "Error" });

  if (errString)
    embed.setDescription(
      "```js\n" + (errString.length > 4096 ? `${errString.substr(0, 4000)}...` : errString) + "\n```"
    );

  embed.addFields({ name: "Description", value: content || "NA" });
  webhookLogger.send({ username: "Logs", embeds: [embed] }).catch((ex) => { });
};

// Send warn webhook
function sendWarnWebhook(content) {
  const errString = content

  const embed = new EmbedBuilder().setColor("DarkGold").setAuthor({ name: "Warn Log" });

  if (errString)
    embed.setDescription(
      "```js\n" + (errString.length > 4096 ? `${errString.substr(0, 4000)}...` : errString) + "\n```"
    );

  embed.addFields({ name: "Description", value: content || "NA" });
  sendWarnhook.send({ username: "Logs", embeds: [embed] }).catch((ex) => { });
};

// Logger class
class Logger {
  /**
   * @param {string} content
   */
  static success(content) {
    pinoLogger.info(content);
  };

  /**
   * @param {string} content
  */
  static log(content) {
    pinoLogger.info(content);
  };

  /**
   * @param {string} content
   */
  static warn(content) {
    pinoLogger.warn(content);
    if (webhookLogger) sendWarnWebhook(content);
  };

  /**
   * @param {string} content
   * @param {Object} ex
   */
  static error(content, ex) {
    if (ex) {
      pinoLogger.error(ex, `${content}: ${ex?.message}`);
    } else {
      pinoLogger.error(content);
    };
    if (webhookLogger) sendWebhook(content, ex);
  };

  /**
   * @param {string} content
   */
  static debug(content) {
    pinoLogger.debug(content);
  };
};

module.exports = Logger;