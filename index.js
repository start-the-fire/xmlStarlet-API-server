const express = require('express');
const { exec } = require('child_process');
const app = express();

// Middleware to parse JSON request bodies
app.use(express.json());

// POST endpoint to extract XML data using xmlStarlet
app.post('/extract', (req, res) => {
  const { filePath, xpath } = req.body;

  // Validate inputs to avoid security issues in production.
  if (!filePath || !xpath) {
    return res.status(400).json({ error: 'filePath and xpath are required.' });
  }

  // Construct the command
  const command = `xmlstarlet sel -t -v "${xpath}" "${filePath}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Command execution error:', error);
      return res.status(500).json({ error: error.message });
    }
    if (stderr) {
      console.error('Command stderr:', stderr);
      return res.status(500).json({ error: stderr });
    }
    res.json({ result: stdout.trim() });
  });
});

// Start the server on port 3000 or the port provided in the environment
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});