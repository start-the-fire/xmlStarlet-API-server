const fs = require('fs');
const express = require('express');
const { spawn } = require('child_process');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const app = express();

app.use(express.json());

// Load your Swagger document (adjust the path as needed)
const swaggerDocument = YAML.load('./swagger.yaml');

// Serve Swagger UI at /api
app.use('/api', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

/**
 * Helper function to transform a given file path.
 * It prepends '/app/xmlfiles' to the incoming path.
 * For example: '/Volumes/test/A.xml' -> '/app/xmlfiles/Volumes/test/A.xml'
 */
function transformPath(inputPath) {
  // If inputPath already begins with "/app/xmlfiles", return it directly.
  if (inputPath.startsWith('/app/xmlfiles')) {
    return inputPath;
  }
  return '/app/xmlfiles' + inputPath;
}

// /extract endpoint
app.post('/extract', (req, res) => {
  let { filePath, xpath } = req.body;
  console.log("Received filePath:", filePath);

  // Transform the file path for processing
  filePath = transformPath(filePath);
  console.log("Transformed filePath for processing:", filePath);

  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    console.error(`File does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'File does not exist.' });
  }

  // Validate XPath length
  if (!xpath || typeof xpath !== 'string' || xpath.length > 200) {
    console.error("Invalid XPath expression:", xpath);
    return res.status(400).json({ error: 'Invalid XPath expression.' });
  }

  // Use spawn to execute xmlstarlet extraction
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
    console.log("Extraction successful. Output:", output.trim());
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ result: output.trim() }) + "\n");
  });
});

// /validate endpoint
app.post('/validate', (req, res) => {
  let { filePath } = req.body;
  console.log("Received filePath for validation:", filePath);

  // Transform the file path
  filePath = transformPath(filePath);
  console.log("Transformed filePath for validation:", filePath);

  // Check if the file exists
  if (!fs.existsSync(filePath)) {
    console.error(`File does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'File does not exist.' });
  }

  // Use spawn to run xmlstarlet validation command
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
    console.log("Validation successful. Message:", output.trim());
    res.json({ valid: true, message: output.trim() });
  });
});

// /transform endpoint
app.post('/transform', (req, res) => {
  let { xmlFilePath, xsltFilePath } = req.body;
  console.log("Received xmlFilePath:", xmlFilePath, "and xsltFilePath:", xsltFilePath);

  // Transform the file paths
  xmlFilePath = transformPath(xmlFilePath);
  xsltFilePath = transformPath(xsltFilePath);
  console.log("Transformed xmlFilePath:", xmlFilePath, "and xsltFilePath:", xsltFilePath);

  // Check if the XML file exists
  if (!fs.existsSync(xmlFilePath)) {
    console.error(`XML file does not exist at path: ${xmlFilePath}`);
    return res.status(400).json({ error: 'XML file does not exist.' });
  }
  // Check if the XSLT file exists
  if (!fs.existsSync(xsltFilePath)) {
    console.error(`XSLT file does not exist at path: ${xsltFilePath}`);
    return res.status(400).json({ error: 'XSLT file does not exist.' });
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
    console.log("Transformation successful. Result:", output.trim());
    res.json({ result: output.trim() });
  });
});

// /format endpoint
app.post('/format', (req, res) => {
  let { filePath, saveTo } = req.body;
  console.log("Received filePath for formatting:", filePath);
  if (saveTo) {
    console.log("Received saveTo path:", saveTo);
  }

  // Transform the source file path
  filePath = transformPath(filePath);
  console.log("Transformed filePath for formatting:", filePath);

  // Check if the source file exists
  if (!fs.existsSync(filePath)) {
    console.error(`Source file does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'Source file does not exist.' });
  }

  // Determine if saveTo was provided and is non-empty
  let saveToProvided = false;
  if (saveTo && saveTo.trim() !== '') {
    // Transform saveTo path as well
    saveTo = transformPath(saveTo);
    console.log("Transformed saveTo path:", saveTo);
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
        console.log(`Formatted XML saved to ${saveTo}`);
        res.json({ message: `Formatted XML saved to ${saveTo}` });
      });
    } else {
      console.log("Returning formatted XML in response.");
      res.json({ result: output });
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});