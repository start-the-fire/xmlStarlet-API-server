const fs = require('fs');
const express = require('express');
const { spawn } = require('child_process');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const app = express();

app.use(express.json());

// Load your Swagger document (adjust the path as needed)
const swaggerDocument = YAML.load('./swagger.yaml');

// Serve Swagger UI at /api-docs
app.use('/api', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.post('/extract', (req, res) => {
  const { filePath, xpath } = req.body;

  // Basic validation for filePath (adjust regex based on your directory structure)
  const filePathRegex = /^\/Volumes\/[\w\-\/.]+\.xml$/;
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
    const resultJson = JSON.stringify({ result: output.trim() }) + "\n";
    res.setHeader('Content-Type', 'application/json');
    res.send(resultJson);
  });
});

app.post('/validate', (req, res) => {
    const { filePath } = req.body;
  
    // Basic validation for filePath (reuse or adjust regex as needed)
    const filePathRegex = /^\/app\/xmlfiles\/[\w\-\/.]+\.xml$/;
    if (!filePath || !filePathRegex.test(filePath)) {
      return res.status(400).json({ error: 'Invalid file path format.' });
    }
  
    // Use spawn to run xmlstarlet val to validate the XML file
    const args = ['val', filePath];
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
        console.error(`Validation failed with code ${code}: ${errorOutput}`);
        return res.status(500).json({ valid: false, error: errorOutput.trim() });
      }
      res.json({ valid: true, message: output.trim() });
    });
  });
  
  app.post('/transform', (req, res) => {
    const { xmlFilePath, xsltFilePath } = req.body;
  
    // Basic validation for file paths (adjust regexes as needed)
    const filePathRegex = /^\/app\/xmlfiles\/[\w\-\/.]+\.(xml|xslt)$/;
    if (!xmlFilePath || !filePathRegex.test(xmlFilePath) || !xsltFilePath || !filePathRegex.test(xsltFilePath)) {
      return res.status(400).json({ error: 'Invalid file path format for XML or XSLT.' });
    }
  
    // Use spawn to execute the transformation command
    const args = ['tr', xsltFilePath, xmlFilePath];
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
        console.error(`Transformation failed with code ${code}: ${errorOutput}`);
        return res.status(500).json({ error: 'Transformation error', details: errorOutput.trim() });
      }
      res.json({ result: output.trim() });
    });
  });

  app.post('/format', (req, res) => {
    const { filePath, saveTo } = req.body;
  
    // Basic validation for the source file path (adjust regex as needed)
    const filePathRegex = /^\/app\/xmlfiles\/[\w\-\/.]+\.xml$/;
    if (!filePath || !filePathRegex.test(filePath)) {
      return res.status(400).json({ error: 'Invalid source file path format.' });
    }
  
    // Determine if saveTo was provided and is non-empty
    let saveToProvided = false;
    if (saveTo && saveTo.trim() !== '') {
      // Validate the destination file path.
      const saveToRegex = /^\/app\/xmlfiles\/[\w\-\/.]+\.xml$/;
      if (!saveToRegex.test(saveTo)) {
        return res.status(400).json({ error: 'Invalid destination file path format.' });
      }
      saveToProvided = true;
    }
  
    // Use spawn to run the xmlstarlet formatting (pretty-printing) command
    const args = ['fo', filePath];
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
        console.error(`xmlstarlet formatting failed with code ${code}: ${errorOutput}`);
        return res.status(500).json({ error: 'Formatting error', details: errorOutput.trim() });
      }
  
      output = output.trim();
  
      if (saveToProvided) {
        // Write the formatted output to the provided destination file path.
        fs.writeFile(saveTo, output, (err) => {
          if (err) {
            console.error('Error writing formatted file:', err);
            return res.status(500).json({ error: 'Failed to save file', details: err.message });
          }
          res.json({ message: `Formatted XML saved to ${saveTo}` });
        });
      } else {
        // Return the formatted output in the response (default behavior)
        res.json({ result: output });
      }
    });
  });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});