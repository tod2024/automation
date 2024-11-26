const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const csv = require('csv-parser');
const sharp = require('sharp');
const JSZip = require('jszip');
const { createCanvas, loadImage } = require('canvas');
require('dotenv').config();  // To use environment variables

// TMDB API Key (Set in environment variables for security)
const TMDB_API_KEY = '7023be09f4209997fe159bee5f0fc3b5';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/original/';
const imagesDir = './ImagesByRatio';
const TimagesDir = './TMDBimages';
const backdropsDir = path.join(TimagesDir, 'backdrops');
const logosDir = path.join(TimagesDir, 'logos');

// Ensure images directories exist
const ensureDirectoriesExist = () => {
    [imagesDir, backdropsDir, logosDir].forEach((dir) => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
};
ensureDirectoriesExist();

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
        await processCSV(req.file.path); // Wait for the processing to finish

        res.send(`
            <p>Processing is complete! You can now download the files:</p>
            <ul>
                <li><a href="/download/processed">Download Processed Images</a></li>
                <li><a href="/download/tmdbimages">Download TMDB Images</a></li>
            </ul>
        `);
    } catch (error) {
        console.error('Error processing CSV file:', error);
        res.status(500).send('<p>Error processing the CSV file. Please try again later.</p>');
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
    const processedZipPath = path.join(__dirname, `processed_images_${filename}.zip`);
    const tmdbZipPath = path.join(__dirname, `TMDBimages_${filename}.zip`);

    if (fs.existsSync(processedZipPath) || fs.existsSync(tmdbZipPath)) {
        res.send(`
            <p>Available downloads:</p>
            <ul>
                ${fs.existsSync(processedZipPath) ? `<li><a href="/download/processed">Processed Images Zip</a></li>` : ''}
                ${fs.existsSync(tmdbZipPath) ? `<li><a href="/download/tmdbimages">TMDB Images Zip</a></li>` : ''}
            </ul>
        `);
    } else {
        res.send('<p>The zip files are not ready yet. Please try again later.</p>');
    }
});

app.get('/download/processed', (req, res) => {
    const zipFilePath = path.join(__dirname, `processed_images_${filename}.zip`);
    if (fs.existsSync(zipFilePath)) {
        res.download(zipFilePath);
    } else {
        res.status(404).send('<p>Processed images zip is not ready yet. Please try again later.</p>');
    }
});

app.get('/download/tmdbimages', (req, res) => {
    const tmdbZipPath = path.join(__dirname, `TMDBimages_${filename}.zip`);
    if (fs.existsSync(tmdbZipPath)) {
        res.download(tmdbZipPath);
    } else {
        res.status(404).send('<p>TMDBimages zip is not ready yet. Please try again later.</p>');
    }
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
    try {
        const url = `${TMDB_BASE_URL}/search/movie`;
        const response = await axios.get(url, {
            params: {
                api_key: TMDB_API_KEY,
                query: movieName
            }
        });
        return response.data.results[0];
    } catch (error) {
        console.error(`Error fetching movie details for "${movieName}":`, error);
        throw error;
    }
};

// Function to fetch movie images from TMDB
const fetchMovieImages = async (movieId) => {
    try {
        const url = `${TMDB_BASE_URL}/movie/${movieId}/images`;
        const response = await axios.get(url, {
            params: {
                api_key: TMDB_API_KEY,
                include_image_language: 'null,en',
                language: 'en-US'
            }
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching movie images for movie ID ${movieId}:`, error);
        throw error;
    }
};

// Function to download an image
const downloadImage = async (imageUrl, imagePath) => {
    try {
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
    } catch (error) {
        console.error(`Error downloading image from ${imageUrl}:`, error);
        throw error;
    }
};

const processImage = async (imagePath, outputImagePath, width, height, addLogo, logoPath) => {
    console.log(`Processing image: ${imagePath} to ${outputImagePath}`);
    try {
        const image = await loadImage(imagePath);
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0, width, height);

        if (addLogo && logoPath && fs.existsSync(logoPath)) {
            const logoImage = await loadImage(logoPath);
            const logoWidth = Math.min(400, logoImage.width);
            const logoHeight = Math.round((logoWidth / logoImage.width) * logoImage.height);
            const logoX = 50;
            const logoY = height - logoHeight - 40;
            context.drawImage(logoImage, logoX, logoY, logoWidth, logoHeight);
        }

        const buffer = canvas.toBuffer();
        fs.writeFileSync(outputImagePath, buffer);
    } catch (error) {
        console.error(`Error processing image ${imagePath}:`, error);
        throw error;
    }
};

const processCSV = async (filePath) => {
    const results = [];
    const zip = new JSZip();
    const stream = fs.createReadStream(filePath).pipe(csv());

    stream.on('data', (data) => results.push(data));

    stream.on('end', async () => {
        try {
            // Loop through each movie in the CSV
            await Promise.all(results.map(async (row) => {
                const movieName = row['Movie Name'];
                try {
                    const movieDetails = await fetchMovieDetails(movieName);
                    if (movieDetails) {
                        const movieId = movieDetails.id;
                        const movieImages = await fetchMovieImages(movieId);

                        // Fetch and save backdrop
                        let backdropUrl = movieImages.backdrops?.[0]?.file_path
                            ? `${TMDB_IMAGE_BASE_URL}${movieImages.backdrops[0].file_path}`
                            : null;

                        if (backdropUrl) {
                            const backdropPath = path.join(backdropsDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop.jpg`);
                            await downloadImage(backdropUrl, backdropPath);

                            // Fetch and save logo if available
                            let logoPath = null;
                            if (movieImages.logos.length > 0) {
                                const logoUrl = `${TMDB_IMAGE_BASE_URL}${movieImages.logos[0].file_path}`;
                                logoPath = path.join(logosDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_logo.png`);
                                await downloadImage(logoUrl, logoPath);
                            }

                            // Process backdrops into different ratios and add them to the zip
                            await Promise.all(ratios.map(async (ratio) => {
                                const outputImagePath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`);
                                await processImage(backdropPath, outputImagePath, ratio.width, ratio.height, ratio.addLogo, logoPath);

                                // Add processed image to zip
                                const data = fs.readFileSync(outputImagePath);
                                zip.file(`${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`, data);
                            }));
                        } else {
                            console.warn(`No backdrop found for movie: ${movieName}`);
                        }
                    }
                } catch (error) {
                    console.error(`Error processing movie "${movieName}":`, error);
                }
            }));

            // Create processed images zip
            const processedZipPath = path.join(__dirname, `processed_images_${filename}.zip`);
            await new Promise((resolve, reject) => {
                zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
                    .pipe(fs.createWriteStream(processedZipPath))
                    .on('finish', () => {
                        console.log(`Processed images zip created at ${processedZipPath}`);
                        resolve();
                    })
                    .on('error', reject);
            });

            // Create TMDBimages zip
            await zipTMDBImages();

            // Cleanup CSV file
            fs.unlinkSync(filePath);
        } catch (error) {
            console.error('Error processing CSV:', error);
            throw error;
        }
    });
};

const zipTMDBImages = async () => {
    const tmdbZip = new JSZip();
    const tmdbFolder = TimagesDir;

    const addFolderToZip = (folderPath, folderName, zipInstance) => {
        const files = fs.readdirSync(folderPath);
        files.forEach((file) => {
            const fullPath = path.join(folderPath, file);
            if (fs.lstatSync(fullPath).isDirectory()) {
                addFolderToZip(fullPath, path.join(folderName, file), zipInstance.folder(folderName));
            } else {
                const data = fs.readFileSync(fullPath);
                zipInstance.folder(folderName).file(file, data);
            }
        });
    };

    addFolderToZip(tmdbFolder, 'TMDBimages', tmdbZip);

    const tmdbZipFilePath = path.join(__dirname, `TMDBimages_${filename}.zip`);
    return new Promise((resolve, reject) => {
        tmdbZip
            .generateNodeStream({ type: 'nodebuffer', streamFiles: true })
            .pipe(fs.createWriteStream(tmdbZipFilePath))
            .on('finish', () => {
                console.log(`TMDBimages zip file created at ${tmdbZipFilePath}`);
                resolve();
            })
            .on('error', reject);
    });
};


app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
