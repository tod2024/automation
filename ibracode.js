const express = require('express');
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

// Function to fetch movie details from TMDB
const fetchMovieDetails = async (movieName) => {
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

// Function to process the CSV file
const processCSV = async (filePath) => {
    const results = [];

    fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            const zip = new JSZip();
            for (const [index, row] of results.entries()) {
                const movieName = row['Movie Name'];
                try {
                    const backdropImagePath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop.jpg`);
                    const logoImagePath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_logo.png`);

                    // Process image for each ratio
                    const promises = [];
                    const resizedImages = [];

                    for (const ratio of ratios) {
                        const resizedImagePath = path.join(imagesDir, `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}`);
                        promises.push(resizeImage(backdropImagePath, resizedImagePath, ratio.width, ratio.height));
                        resizedImages.push({ path: resizedImagePath, name: `${movieName.replace(/[^a-zA-Z0-9]/g, '_')}_backdrop_${ratio.width}x${ratio.height}.${ratio.format}` });
                    }

                    await Promise.all(promises);

                    // Add resized images to zip file
                    for (const resizedImage of resizedImages) {
                        const data = fs.readFileSync(resizedImage.path);
                        zip.file(resizedImage.name, data);
                    }

                    console.log(`Resized and added images for "${movieName}"`);
                } catch (error) {
                    console.error(`Error processing "${movieName}":`, error.message);
                }
            }

            // Generate and save zip file
            zip.generateAsync({ type: 'nodebuffer' }).then((content) => {
                fs.writeFileSync(path.join(__dirname, 'processed_images.zip'), content);
                console.log('Zip file created and saved.');
            });

            // Delete the uploaded file after processing
            fs.unlinkSync(filePath);
        });
};

// Endpoint to handle file uploads
app.post('/upload', (req, res) => {
    const filePath = req.body.filePath; // Assuming you send the file path from frontend
    processCSV(filePath);
    res.send('Processing started.');
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});

// Define your ratios here
const ratios = [
    { width: 240, height: 135, format: 'png', addLogo: false },
    { width: 800, height: 450, format: 'png', addLogo: false },
    { width: 1280, height: 480, format: 'png', addLogo: true },
    { width: 640, height: 360, format: 'webp', addLogo: false }
];
