const { createCanvas, loadImage } = require("canvas");
const { PrayerTimes } = require("muwaqqit");

/**
 * @param {Object} data
 * @param {string} data.city
 * @param {string} data.country
 * @param {number} data.method
 * @param {string} [data.format="12h"]
 * @returns {Promise<{imageBuffer: Buffer, description: string}>}
 */
module.exports = async function drawPrayerTimes(data) {
  const pt = new PrayerTimes({
    city: data.city || "Cairo",
    country: data.country || "Egypt",
    method: data.method || 5,
    format: data.format || "12h",
  });
  const times = await pt.getTimes(new Date());

  function formatTime12h(timeStr) {
    let [time, period] = timeStr.toLowerCase().split(" ");
    let [hours, minutes] = time.split(":").map((t) => t.trim());

    hours = parseInt(hours, 10);
    minutes = minutes.padStart(2, "0");

    let formattedHours = String(hours).padStart(2, "0");

    return {
      time: `${formattedHours}:${minutes}`,
      period: period.toUpperCase(),
    };
  }

  const fajr = formatTime12h(times.Fajr);
  const dhuhr = formatTime12h(times.Dhuhr);
  const asr = formatTime12h(times.Asr);
  const maghrib = formatTime12h(times.Maghrib);
  const isha = formatTime12h(times.Isha);

  const city = data.city || "Cairo";
  const now = new Date();
  const monthName = now.toLocaleString("en-US", { month: "long" });
  const day = now.getDate();
  const year = now.getFullYear();
  const formattedDate = `${monthName} ${day}, ${year}`;

  const texts = [
    { text: fajr.time, x: 305, y: 560, fontSize: 80, color: "white", align: "center" },
    { text: fajr.period, x: 305, y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: dhuhr.time, x: 635, y: 560, fontSize: 80, color: "white", align: "center" },
    { text: dhuhr.period, x: 635, y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: asr.time, x: 960, y: 560, fontSize: 80, color: "white", align: "center" },
    { text: asr.period, x: 960, y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: maghrib.time, x: 1290, y: 560, fontSize: 80, color: "white", align: "center" },
    { text: maghrib.period, x: 1290, y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: isha.time, x: 1615, y: 560, fontSize: 80, color: "white", align: "center" },
    { text: isha.period, x: 1615, y: 700, fontSize: 40, color: "yellow", align: "center" },
    { text: city, x: 1600, y: 165, fontSize: 60, color: "black", align: "left" },
    { text: formattedDate, x: 1500, y: 255, fontSize: 40, color: "black", align: "left" },
  ];

  const canvasWidth = 1920;
  const canvasHeight = 1080;
  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  const backgroundImage = "https://i.postimg.cc/FFdYTNjj/pray.png";
  let image = await loadImage(backgroundImage).catch((err) =>
    console.error("Error loading image:", err)
  );
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  texts.forEach((item) => {
    ctx.fillStyle = item.color || "white";
    ctx.font = `${item.fontSize || 30}px Amiri`;
    ctx.textAlign = item.align || "left";
    ctx.textBaseline = "top";
    ctx.fillText(item.text, item.x, item.y);
  });

  return {
    imageBuffer: canvas.toBuffer(),
  };
};
