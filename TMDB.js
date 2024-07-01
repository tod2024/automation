const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const csv = require('csv-parser');
const sharp = require('sharp');
const JSZip = require('jszip');

const app = express();
const port = 3000;

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

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the HTML form for file upload
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint to handle logo upload
app.post('/uploadLogo', upload.single('logo'), (req, res) => {
    const logoPath = path.join(logosDir, 'logo.png');

    fs.rename(req.file.path, logoPath, (err) => {
        if (err) {
            console.error('Error moving uploaded logo:', err);
            return res.status(500).send('Error uploading logo');
        }
        res.send('Logo uploaded successfully');
    });
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
        return response.data.results[0]; // Return the first search result
    } catch (error) {
        console.error(`Error fetching details for "${movieName}":`, error.message);
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
        console.error(`Error fetching images for movie ID "${movieId}":`, error.message);
        throw error;
    }
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
    try {
        let image = sharp(imagePath).resize(width, height);

        // Add gradient layer if required
        if (width === 1280 && height === 480) {
            const gradient = {
                left: { r: 1, g: 0, b: 0, alpha: 1 },
                right: { r: 1, g: 0, b: 0, alpha: 0 }
            };

            image = image.composite([{
                input: Buffer.from(`<svg><rect x="0" y="0" width="${width}" height="${height}" fill="url(#grad1)"/></svg>`),
                blend: 'overlay'
            }]);
        }

        // Add logo if required
        if (addLogo && logoPath && fs.existsSync(logoPath)) {
            const logoImage = sharp(logoPath);
            const { width: logoWidth, height: logoHeight } = await logoImage.metadata();
            const logoResizeWidth = Math.min(400, logoWidth);
            const logoResizeHeight = logoResizeWidth / logoWidth * logoHeight;

            // Calculate position for the logo (bottom left corner)
            const logoPositionX = 50;  // Offset from left
            const logoPositionY = height - logoResizeHeight - 40;  // Offset from bottom

            image = image.composite([{
                input: await logoImage.resize(logoResizeWidth, logoResizeHeight).toBuffer(),
                top: logoPositionY,
                left: logoPositionX
            }]);
        }

        await image.toFile(outputImagePath);
        console.log(`Processed image saved as ${outputImagePath}`);
    } catch (error) {
        console.error(`Error processing image ${imagePath}:`, error.message);
    }
};

// Function to process the CSV file
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
                        if (movieImages.backdrops.length > 0) {
                            const backdropUrl = `${TMDB_IMAGE_BASE_URL}${movieImages.backdrops[0].file_path}`;
                            const backdropPath = path.join(backdropsDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop.jpg`);
                            await downloadImage(backdropUrl, backdropPath);
                            console.log(`Downloaded backdrop for "${movieName}"`);

                            // Process each ratio for the backdrop
                            for (const ratio of ratios) {
                                const outputImagePath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`);
                                const logoPath = path.join(logosDir, 'logo.png'); // Use the uploaded logo
                                await processImage(backdropPath, outputImagePath, ratio.width, ratio.height, ratio.addLogo, logoPath);

                                const data = fs.readFileSync(outputImagePath);
                                zip.file(`${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`, data);
                            }

                            console.log(`Processed images for "${movieName}"`);
                        } else {
                            console.log(`No backdrop found for "${movieName}"`);
                        }

                        if (movieImages.logos.length > 0) {
                            const logoUrl = `${TMDB_IMAGE_BASE_URL}${movieImages.logos[0].file_path}`;
                            const logoPath = path.join(logosDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_logo.png`);
                            await downloadImage(logoUrl, logoPath);
                            console.log(`Downloaded logo for "${movieName}"`);
                        } else {
                            console.log(`No logo found for "${movieName}"`);
                        }
                    } else {
                        console.log(`No details found for "${movieName}"`);
                    }
                } catch (error) {
                    console.error(`Error fetching details for "${movieName}":`, error.message);
                }
            }

            // Generate and save zip file
            const zipFileName = 'processed_images.zip';
            const zipFilePath = path.join(__dirname, zipFileName);
            zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
                .pipe(fs.createWriteStream(zipFilePath))
                .on('finish', () => {
                    console.log(`Zip file "${zipFileName}" created and saved.`);
                });

            // Delete the uploaded file after processing
            fs.unlinkSync(filePath);
        });
};


// Endpoint to handle file uploads
app.post('/upload', upload.single('file'), (req, res) => {
    const filePath = req.file.path;
    processCSV(filePath).catch(err => {
        console.error('Error processing CSV:', err.message);
        res.status(500).send('Error processing CSV');
    });
    res.send('File uploaded and processing started.');
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
