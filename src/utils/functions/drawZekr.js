const { createCanvas, loadImage } = require('canvas');

const images = [
  "https://i.ibb.co/2qcR1pN/1726884844935.jpg",
  "https://i.ibb.co/Z1f62QC/1726884858061.jpg",
  "https://i.ibb.co/3c0Zr73/1726884869504.jpg",
  "https://i.ibb.co/h9bZgj8/1726884875539.jpg",
  "https://i.ibb.co/BZS3Jr3/1726884883932.jpg",
  "https://i.ibb.co/G2n77p6/1726884879073.jpg"
];


/**
 * Draw a zekr on a random background image.
 * @param {{category: string, reference: string, zekr: string, description: string}} zekr - an object with the following properties:
 *   - category {string} - category of the zekr
 *   - reference {string} - reference to the zekr
 *   - zekr {string} - the zekr itself
 *   - description {string} - description of the zekr
 * @returns {Promise<{imageBuffer: Buffer, description: string}>} - an object with the following properties:
 *   - imageBuffer {Buffer} - buffer of the image
 *   - description {string} - description of the zekr
 */
module.exports = async function drawZekr(zekr) {


  const randomText = zekr;
  const wordCount = randomText.zekr.split(' ').length;

  let canvasWidth = 1259;
  let canvasHeight = 512;

  if (wordCount > 50) {
    canvasWidth = 1600;
    canvasHeight = 800;
  }

  if (wordCount > 60) {
    canvasWidth = 1600;
    canvasHeight = 1000;
  }

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  const randomImage = images[Math.floor(Math.random() * images.length)];

  let image = await loadImage(randomImage).catch((err) => console.error('Error loading image:', err))

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'white';
  ctx.font = 'bold 45px Amiri';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(randomText.category, canvas.width / 2, 30);

  ctx.fillStyle = 'white';
  ctx.font = 'italic 35px Amiri';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(randomText.reference, 20, canvas.height - 20);

  ctx.fillStyle = 'white';
  ctx.font = '40px Amiri';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';


  const x = canvas.width / 2;
  const fontSize = Math.max(25, Math.min(60, 60 - (wordCount - 20) * 2));
  const y = canvas.height / 2 - fontSize / 2;

  ctx.font = `${fontSize}px Amiri`;

  const wrapText = (ctx, text, x, y, maxWidth, lineHeight) => {
    const lines = text.split(/\n/);
    let startY = y - ((lines.length - 1) * lineHeight) / 2;

    if (startY > canvas.height) {
      canvas.height = startY + 50;
      ctx.font = `${fontSize + 15}px Amiri`;
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    }

    lines.forEach(line => {
      const words = line.split(' ');
      let currentLine = '';

      words.forEach(word => {
        const testLine = currentLine + word + ' ';
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          ctx.fillText(currentLine, x, startY);
          currentLine = word + ' ';
          startY += lineHeight;
        } else {
          currentLine = testLine;
        }
      });

      ctx.fillText(currentLine, x, startY);
      startY += lineHeight;
    });


  };
  wrapText(ctx, randomText.zekr, x, y, canvas.width - 170, 80);

  let description = '** **';
  if (randomText.description && randomText.description.length > 1) {
    description = `** \`-\` ${randomText.description}**`;
  }





  return { imageBuffer: canvas.toBuffer(), description: description }
}