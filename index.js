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
 * Helper function to transform an incoming file path.
 * It prepends '/app/xmlfiles' if the input does not already start with it.
 * For example:
 *   '/Volumes/Helmut/helmut480-test/A.xml' becomes
 *   '/app/xmlfiles/Volumes/Helmut/helmut480-test/A.xml'
 */
function transformPath(inputPath) {
  console.log("transformPath - Received inputPath:", inputPath);
  if (!inputPath) {
    console.log("transformPath - No inputPath provided, returning:", inputPath);
    return inputPath;
  }
  inputPath = inputPath.trim();
  console.log("transformPath - After trim:", inputPath);
  if (inputPath.startsWith('/app/xmlfiles')) {
    console.log("transformPath - Path already starts with '/app/xmlfiles', returning:", inputPath);
    return inputPath;
  }
  if (!inputPath.startsWith('/')) {
    inputPath = '/' + inputPath;
    console.log("transformPath - Prepended leading slash, path now:", inputPath);
  }
  const transformed = '/app/xmlfiles' + inputPath;
  console.log("transformPath - Final transformed path:", transformed);
  return transformed;
}

// /extract endpoint
app.post('/extract', (req, res) => {
  console.log("=== /extract endpoint called ===");
  console.log("Request body:", req.body);
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
  console.log("Executing xmlstarlet with args:", args);
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
  console.log("=== /validate endpoint called ===");
  console.log("Request body:", req.body);
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
  console.log("Executing xmlstarlet for validation with args:", args);
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
  console.log("=== /transform endpoint called ===");
  console.log("Request body:", req.body);
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
  console.log("Executing xmlstarlet transformation with args:", args);
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
  console.log("=== /format endpoint called ===");
  console.log("Request body:", req.body);
  let { filePath, saveTo, logToConsole } = req.body;
  
  // Ensure logToConsole is a boolean (defaulting to false)
  logToConsole = logToConsole === true;
  console.log("logToConsole is set to:", logToConsole);

  console.log("Received filePath for formatting:", filePath);
  if (saveTo) {
    console.log("Received saveTo path:", saveTo);
  }

  // Transform the source file path for processing
  filePath = transformPath(filePath);
  console.log("Transformed filePath for formatting:", filePath);

  // Check if the source file exists
  if (!fs.existsSync(filePath)) {
    console.error(`Source file does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'Source file does not exist.' });
  }

  // Determine if saveTo was provided and is non-empty; if so, transform it.
  let saveToProvided = false;
  if (saveTo && saveTo.trim() !== '') {
    saveTo = transformPath(saveTo);
    console.log("Transformed saveTo path:", saveTo);
    saveToProvided = true;
  }

  // Use spawn to run the xmlstarlet formatting (pretty-printing) command
  const args = ['fo', filePath];
  console.log("Executing xmlstarlet formatting with args:", args);
  const child = spawn('xmlstarlet', args);

  let output = '';
  let errorOutput = '';

  child.stdout.on('data', (data) => {
    // Log stdout data only if logToConsole is enabled
    if (logToConsole) {
      console.log("Formatting stdout data:", data.toString());
    }
    output += data;
  });

  child.stderr.on('data', (data) => {
    console.log("Formatting stderr data:", data.toString());
    errorOutput += data;
  });

  child.on('error', (err) => {
    console.error("Child process error:", err);
  });

  child.on('close', (code) => {
    console.log("Child process closed with code:", code);
    if (code !== 0) {
      console.error(`xmlstarlet formatting failed with code ${code}: ${errorOutput}`);
      return res.status(500).json({ error: 'Formatting error', details: errorOutput.trim() });
    }

    output = output.trim();
    // If logToConsole is enabled, also print the final formatted output
    if (logToConsole) {
      console.log("Final formatted output:\n", output);
    }

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