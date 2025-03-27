const express = require('express');
const { spawn } = require('child_process');
const app = express();

app.use(express.json());

app.post('/extract', (req, res) => {
  const { filePath, xpath } = req.body;

  // Basic validation for filePath (adjust regex based on your directory structure)
  const filePathRegex = /^\/app\/xmlfiles\/[\w\-\/.]+\.xml$/;
  if (!filePath || !filePathRegex.test(filePath)) {
    return res.status(400).json({ error: 'Invalid file path format.' });
  }

  // Validate XPath length
  if (!xpath || typeof xpath !== 'string' || xpath.length > 200) {
    return res.status(400).json({ error: 'Invalid XPath expression.' });
  }

  // Use spawn to avoid shell injection risks
  const args = ['sel', '-t', '-v', xpath, filePath];
  const child = spawn('xmlstarlet', args);

  let output = '';
  let errorOutput = '';

  child.stdout.on('data', (data) => {
    output += data;
  });

  child.stderr.on('data', (data) => {
    errorOutput += data;
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`xmlstarlet exited with code ${code}: ${errorOutput}`);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    const resultJson = JSON.stringify({ result: stdout }) + "\n";
    res.setHeader('Content-Type', 'application/json');
    res.send(resultJson);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});