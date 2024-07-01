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
const imagesDir = './TMDBimages';

// Ensure images directory exists
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir);
}

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve the HTML form for file upload
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Define your ratios here
const ratios = [
    { width: 240, height: 135, format: 'png', addLogo: false },
    { width: 800, height: 450, format: 'png', addLogo: false },
    { width: 1280, height: 480, format: 'png', addLogo: true },
    { width: 640, height: 360, format: 'webp', addLogo: false }
];
 async (movieName) => {
    const url = `${TMDB_BASE_URL}/search/movie`;
    const response = await axios.get(url, {
        params: {
            api_key: TMDB_API_KEY,
            query: movieName
        }
    });
    return response.data.results[0]; // Return the first search result
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

// Function to resize an image to a specific aspect ratio
const resizeImage = async (imagePath, outputImagePath, width, height) => {
    try {
        await sharp(imagePath)
            .resize(width, height)
            .toFile(outputImagePath);
        console.log(`Image resized to ${width}x${height} and saved as ${outputImagePath}`);
    } catch (error) {
        console.error(`Error resizing image ${imagePath}:`, error.message);
    }
};

// Function to add a logo to an image
const addLogoToImage = async (imagePath, logoPath, outputImagePath) => {
    try {
        await sharp(imagePath)
            .composite([{ input: logoPath, gravity: 'southeast' }])
            .toFile(outputImagePath);
        console.log(`Logo added to image ${outputImagePath}`);
    } catch (error) {
        console.error(`Error adding logo to image ${imagePath}:`, error.message);
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
                            const backdropPath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop.jpg`);
                            await downloadImage(backdropUrl, backdropPath);
                            console.log(`Downloaded backdrop for "${movieName}"`);

                            // Process each ratio for the backdrop
                            for (const ratio of ratios) {
                                const resizedImagePath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`);
                                await resizeImage(backdropPath, resizedImagePath, ratio.width, ratio.height);

                                if (ratio.addLogo && ratio.width === 1280 && ratio.height === 480) {
                                    const logoPath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_logo.png`);
                                    if (fs.existsSync(logoPath)) {
                                        const logoOutputPath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}_with_logo.${ratio.format}`);
                                        await addLogoToImage(resizedImagePath, logoPath, logoOutputPath);
                                        const data = fs.readFileSync(logoOutputPath);
                                        zip.file(`${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}_with_logo.${ratio.format}`, data);
                                    } else {
                                        console.log(`Logo file not found for "${movieName}". Skipping logo addition.`);
                                    }
                                } else {
                                    const data = fs.readFileSync(resizedImagePath);
                                    zip.file(`${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`, data);
                                }
                            }

                            console.log(`Processed images for "${movieName}"`);
                        } else {
                            console.log(`No backdrop found for "${movieName}"`);
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
