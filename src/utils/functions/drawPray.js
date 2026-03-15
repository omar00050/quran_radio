const { createCanvas, loadImage } = require("canvas");
const moment = require("moment-timezone");

/**
 * Convert an Aladhan API time string to { time, period } for display.
 * Input examples: "05:05 (EET)", "13:30 (+03)"
 */
function formatTime(timeStr, format = "12h") {
  const match = timeStr?.match(/^(\d+):(\d+)/);
  if (!match) return { time: "--:--", period: "" };

  let hour = parseInt(match[1]);
  const minute = match[2];

  if (format === "12h") {
    const period = hour >= 12 ? "PM" : "AM";
    if (hour > 12) hour -= 12;
    if (hour === 0) hour = 12;
    return { time: `${String(hour).padStart(2, "0")}:${minute}`, period };
  }

  return { time: `${String(hour).padStart(2, "0")}:${minute}`, period: "" };
}

/**
 * Draw a prayer times image using pre-fetched Aladhan API timings.
 *
 * @param {Object} data
 * @param {Object} data.timings         - Aladhan timings object for today
 * @param {string} data.city            - City name (English)
 * @param {string} [data.city_ar]       - City name (Arabic)
 * @param {string} [data.format="12h"]  - "12h" or "24h"
 * @param {string} [data.timezone]      - IANA timezone string
 * @returns {Promise<{imageBuffer: Buffer}>}
 */
module.exports = async function drawPrayerTimes(data) {
  const format = data.format || "12h";
  const timings = data.timings || {};

  const fajr = formatTime(timings.Fajr, format);
  const dhuhr = formatTime(timings.Dhuhr, format);
  const asr = formatTime(timings.Asr, format);
  const maghrib = formatTime(timings.Maghrib, format);
  const isha = formatTime(timings.Isha, format);

  const now = data.timezone ? moment().tz(data.timezone) : moment();
  const formattedDate = now.format("MMMM D, YYYY");
  const city = data.city || "";

  const texts = [
    { text: fajr.time,      x: 305,  y: 560, fontSize: 80, color: "white",  align: "center" },
    { text: fajr.period,    x: 305,  y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: dhuhr.time,     x: 635,  y: 560, fontSize: 80, color: "white",  align: "center" },
    { text: dhuhr.period,   x: 635,  y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: asr.time,       x: 960,  y: 560, fontSize: 80, color: "white",  align: "center" },
    { text: asr.period,     x: 960,  y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: maghrib.time,   x: 1290, y: 560, fontSize: 80, color: "white",  align: "center" },
    { text: maghrib.period, x: 1290, y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: isha.time,      x: 1615, y: 560, fontSize: 80, color: "white",  align: "center" },
    { text: isha.period,    x: 1615, y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: city,           x: 1600, y: 165, fontSize: 60, color: "black",  align: "left" },
    { text: formattedDate,  x: 1500, y: 255, fontSize: 40, color: "black",  align: "left" },
  ];

  const canvas = createCanvas(1920, 1080);
  const ctx = canvas.getContext("2d");

  const backgroundImage = "https://i.ibb.co/5gJTjvfT/Prayer.png";
  const image = await loadImage(backgroundImage).catch((err) =>
    console.error("[Prayer] Error loading background image:", err)
  );
  if (image) ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  for (const item of texts) {
    ctx.fillStyle = item.color || "white";
    ctx.font = `${item.fontSize || 30}px Amiri`;
    ctx.textAlign = item.align || "left";
    ctx.textBaseline = "top";
    ctx.fillText(item.text, item.x, item.y);
  }

  return { imageBuffer: canvas.toBuffer() };
};
