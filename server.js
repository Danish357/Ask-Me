
import express from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Redis from 'redis';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Directory setup
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API Configuration
const api_key = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(api_key);
const generationConfig = {
    temperature: 0.7,  // Lower temperature for faster generation
    topP: 0.9,
    topK: 40,
    maxOutputTokens: 1500  // Limit token count for speed
};

// Initialize Model with Timeout
const model = genAI.getGenerativeModel({ model: "gemini-pro", generationConfig });
const modelTimeout = 10000; // 5 seconds timeout for model requests

// Initialize Redis client with connection pooling
const redisClient = Redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
        reconnectStrategy: retries => Math.min(retries * 100, 3000)
    }
});
await redisClient.connect();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Render form
app.get('/', (req, res) => res.render('index'));

// Handle query submission with caching and timeout
app.post('/generate', async (req, res) => {
    const prompt = req.body.prompt;

    try {
        // Debounced cache check to prevent redundant cache hits
        const cachedResponse = await redisClient.get(prompt);
        if (cachedResponse) {
            return res.json({ text: cachedResponse });
        }

        // Generate content with timeout
        const result = await Promise.race([
            model.generateContent(prompt),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Model timeout")), modelTimeout))
        ]);

        const response = await result.response;
        const generatedText = response.text();

        // Cache and send the response asynchronously
        redisClient.set(prompt, generatedText, { EX: 3600 }).catch(err => console.error("Redis cache error:", err));
        res.json({ text: generatedText });

    } catch (error) {
        console.error('Error generating content:', error);
        res.status(500).send('Error generating content');
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
