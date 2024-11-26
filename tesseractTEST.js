const Tesseract = require('tesseract.js');

Tesseract.recognize(
  'C:/Users/Amit/Documents/STB/automation/processed_images_2024-08-22_13-09-36/The_Blind_backdrop_800x450.png',
  'eng',
  {
    logger: (m) => console.log(m),
  }
).then(({ data: { text } }) => {
  console.log(text);
});
