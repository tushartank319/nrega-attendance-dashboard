const express = require('express');
const cors = require('cors');
const path = require('path');
const { scrapeAttendance } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Endpoint for NREGA daily attendance scraping.
 * Uses Server-Sent Events (SSE) to send progress updates and final scraped data.
 */
app.get('/api/attendance', async (req, res) => {
  const { date, state } = req.query;

  if (!date) {
    return res.status(400).json({ error: 'Date parameter (date) is required. Format: DD/MM/YYYY' });
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  const sendProgress = (progressData) => {
    res.write(`data: ${JSON.stringify(progressData)}\n\n`);
  };

  try {
    const result = await scrapeAttendance(date, state || '07', (progress) => {
      sendProgress(progress);
    });
    
    // Send final result
    sendProgress({ step: 'success', result });
    res.end();
  } catch (error) {
    console.error('Scraping failed:', error);
    sendProgress({ step: 'error', message: error.message });
    res.end();
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` NREGA Attendance Dashboard Server is Running!`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
