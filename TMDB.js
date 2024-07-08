const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const csv = require('csv-parser');
const sharp = require('sharp');
const JSZip = require('jszip');
const { createCanvas, loadImage } = require('canvas');

// TMDB API Key (Replace with your own TMDB API key)
const TMDB_API_KEY = '7023be09f4209997fe159bee5f0fc3b5';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/original/';
const imagesDir = './ImagesByRatio';
const TimagesDir = './TMDBimages';
const backdropsDir = path.join(TimagesDir, 'backdrops');
const logosDir = path.join(TimagesDir, 'logos');

// Ensure images directories exist
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir);
}
if (!fs.existsSync(backdropsDir)) {
    fs.mkdirSync(backdropsDir);
}
if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir);
}

const app = express();
const port = 3000;

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Serve the HTML form for file upload
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '/index.html'));
});

app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        await processCSV(req.file.path);
        res.send('Images processed successfully. Download the zip file <a href="/download">here</a>.');
    } catch (error) {
        console.error('Error processing CSV file:', error);
        res.status(500).send('Error processing CSV file.');
    }
});

// Function to generate a timestamp string
function generateTimestamp() {
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    return timestamp;
}

// Function to pad single digit numbers with a leading zero
function pad(number) {
    return number < 10 ? '0' + number : number;
}

// Example usage
const filename = `${generateTimestamp()}`;
console.log(filename);  // Outputs something like: myfile_2024-07-01_14-30-00.txt

app.get('/download', (req, res) => {
    const zipFilePath = path.join(__dirname, `processed_images_${filename}.zip`);
    res.download(zipFilePath);
    console.log("after run:: " + filename);  // Outputs something like: myfile_2024-07-01_14-30-00.txt
});

// Define your ratios here
const ratios = [
    { width: 240, height: 135, format: 'png', addLogo: false },
    { width: 800, height: 450, format: 'png', addLogo: false },
    { width: 1280, height: 480, format: 'png', addLogo: true },
    { width: 640, height: 360, format: 'webp', addLogo: false }
];

// Function to fetch movie details from TMDB
const fetchMovieDetails = async (movieName) => {
    const url = `${TMDB_BASE_URL}/search/movie`;
    const response = await axios.get(url, {
        params: {
            api_key: TMDB_API_KEY,
            query: movieName
        }
    });
    return response.data.results[0];
};

// Function to fetch movie images from TMDB
const fetchMovieImages = async (movieId) => {
    const url = `${TMDB_BASE_URL}/movie/${movieId}/images`;
    const response = await axios.get(url, {
        params: {
            api_key: TMDB_API_KEY,
            include_image_language: 'null,en',
            language: 'en-US'
        }
    });
    return response.data;
};

// Function to download an image
const downloadImage = async (imageUrl, imagePath) => {
    const writer = fs.createWriteStream(imagePath);
    const response = await axios({
        url: imageUrl,
        method: 'GET',
        responseType: 'stream'
    });
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

const processImage = async (imagePath, outputImagePath, width, height, addLogo, logoPath) => {
    console.log(`Processing image: ${imagePath} to ${outputImagePath}`);

    // Load the backdrop image
    const image = await loadImage(imagePath);

    // Create a canvas
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');

    // Draw the backdrop image onto the canvas
    context.drawImage(image, 0, 0, width, height);

    if (addLogo && logoPath && fs.existsSync(logoPath)) {
        console.log(`Adding logo: ${logoPath} to image: ${outputImagePath}`);

        // Load the logo image
        const logoImage = await loadImage(logoPath);
        const logoWidth = Math.min(400, logoImage.width);
        const logoHeight = Math.round((logoWidth / logoImage.width) * logoImage.height); // Ensure height is an integer
        const logoX = 50;
        const logoY = height - logoHeight - 40;

        // Draw the logo onto the canvas
        context.drawImage(logoImage, logoX, logoY, logoWidth, logoHeight);
    }

    // Save the final image
    const buffer = canvas.toBuffer();
    fs.writeFileSync(outputImagePath, buffer);
};

const processCSV = async (filePath) => {
    const results = [];
    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            const zip = new JSZip();
            for (const row of results) {
                const movieName = row['Movie Name'];
                try {
                    const movieDetails = await fetchMovieDetails(movieName);
                    if (movieDetails) {
                        const movieId = movieDetails.id;
                        const movieImages = await fetchMovieImages(movieId);

                        // Search for a non-empty backdrop image
                        let backdropUrl = null;
                        for (const backdrop of movieImages.backdrops) {
                            if (backdrop.file_path) {
                                backdropUrl = `${TMDB_IMAGE_BASE_URL}${backdrop.file_path}`;
                                break;
                            }
                        }

                        if (backdropUrl) {
                            const backdropPath = path.join(backdropsDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop.jpg`);
                            await downloadImage(backdropUrl, backdropPath);

                            // Download logo image if exists
                            let logoPath = null;
                            if (movieImages.logos.length > 0) {
                                const logoUrl = `${TMDB_IMAGE_BASE_URL}${movieImages.logos[0].file_path}`;
                                logoPath = path.join(logosDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_logo.png`);
                                await downloadImage(logoUrl, logoPath);
                            } else {
                                console.warn(`No logo found for movie: ${movieName}`);
                            }

                            for (const ratio of ratios) {
                                const outputImagePath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`);
                                await processImage(backdropPath, outputImagePath, ratio.width, ratio.height, ratio.addLogo, logoPath);

                                const data = fs.readFileSync(outputImagePath);
                                zip.file(`${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`, data);
                            }
                        } else {
                            console.warn(`No non-empty backdrop found for movie: ${movieName}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error processing movie "${movieName}":`, error);
                }
            }
            const zipFilePath = path.join(__dirname, `processed_images_${filename}.zip`);
            zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
                .pipe(fs.createWriteStream(zipFilePath))
                .on('finish', () => {
                    console.log(`Zip file created at ${zipFilePath}`);
                    console.log("after run:: " + filename);  // Outputs something like: myfile_2024-07-01_14-30-00.txt
                });

            fs.unlinkSync(filePath);
        });
};

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
