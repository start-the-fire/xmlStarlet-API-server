const fs = require('fs');
const path = require('path');
const express = require('express');
const { spawn } = require('child_process');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const { XMLParser, XMLBuilder } = require("fast-xml-parser");
const { jsonrepair } = require('jsonrepair');
const sax  = require('sax');

const app = express();
app.use(express.json());

// API Key Middleware
const API_KEY = process.env.API_KEY;
const freeUsageCount = {};  // In-memory store for tracking free usage by IP
const MAX_FREE_QUERIES = 3;
app.use((req, res, next) => {
  // Bypass API key verification for public endpoints
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/swagger') ||
    req.path.startsWith('/changelog')
  ) {
    return next();
  }

  const key = req.headers['x-api-key'];

  // If a valid API key is provided, allow unlimited usage.
  if (key === API_KEY) {
    return next();
  }

  // If a key is provided but it's invalid, reject the request.
  if (key) {
    console.error("Invalid API key provided:", key);
    return res.status(403).json({ error: 'Forbidden: Invalid API key.' });
  }

  // No API key provided, count this as free usage.
  const clientIp = req.ip;
  freeUsageCount[clientIp] = (freeUsageCount[clientIp] || 0) + 1;

  if (freeUsageCount[clientIp] > MAX_FREE_QUERIES) {
    console.error(`Free usage limit exceeded for IP: ${clientIp}`);
    return res.status(429).json({
      error: 'Max query limit reached for free usage. Please provide a valid license key for unlimited access.'
    });
  }

  next();
});

// Load your Swagger document (adjust the path as needed)
const swaggerDocument = YAML.load('./swagger.yaml');

// Serve Swagger UI at /api
app.use('/api', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Serve the raw swagger.yaml file at /swagger
app.get('/swagger', (req, res) => {
  res.sendFile(path.join(__dirname, './swagger.yaml'));
});

// Serve the changelog HTML page
app.get('/changelog', (req, res) => {
  res.sendFile(path.join(__dirname, './public/changelog.html'));
});

// Dedicated endpoint to return the changelog JSON data
app.get('/changelog-json', (req, res) => {
  console.log("=== /changelog-json endpoint called ===");
  fs.readFile('./version.json', 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading version.json:", err);
      return res.status(500).json({ error: "Error reading version information" });
    }
    try {
      const versionInfo = JSON.parse(data);
      return res.json({ changelog: versionInfo.changelog });
    } catch (parseErr) {
      console.error("Error parsing version.json:", parseErr);
      return res.status(500).json({ error: "Error parsing version information" });
    }
  });
});

// Define a directory for downloads (internal to the container)
const DOWNLOAD_DIR = '/app/downloads';
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  console.log(`Created downloads directory: ${DOWNLOAD_DIR}`);
}
app.use('/download', express.static(DOWNLOAD_DIR));

// Check if the API_KEY environment variable is set
if (process.env.API_KEY) {
  console.log('Environment variable for API communication available');
} else {
  console.log('Environment variable for API communication is missing!');
}

/**
 * Helper function to transform an incoming file path.
 * It prepends '/app/xmlfiles' if the input does not already start with it.
 * For example: '/Volumes/Helmut/helmut480-test/A.xml' becomes '/app/xmlfiles/Volumes/Helmut/helmut480-test/A.xml'
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

/* ========================
   /xmlextract endpoint
   Expected input: 
     {
       filePath: string, 
       xpath: string,
       asArray?: boolean
     }
======================== */
app.post('/xmlextract', (req, res) => {
  console.log("=== /xmlextract endpoint called ===");
  console.log("Request body:", req.body);

  let { filePath, xpath, asArray = false } = req.body;
  console.log("Received filePath:", filePath, "xpath:", xpath, "asArray:", asArray);

  // Transform and validate path
  filePath = transformPath(filePath);
  console.log("Transformed filePath for processing:", filePath);

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.xml') {
    console.error(`Invalid input file extension: ${ext}. Expected .xml`);
    return res.status(400).json({ error: 'Invalid input file extension. Expected .xml' });
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'File does not exist.' });
  }
  if (!xpath || typeof xpath !== 'string' || xpath.length > 200) {
    console.error("Invalid XPath expression:", xpath);
    return res.status(400).json({ error: 'Invalid XPath expression.' });
  }

  // Run xmlstarlet
  const args = ['sel', '-t', '-v', xpath, filePath];
  console.log("Executing xmlstarlet with args:", args);
  const child = spawn('xmlstarlet', args);

  let output = '';
  let errorOutput = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { errorOutput += data; });

  child.on('close', code => {
    if (code !== 0) {
      console.error(`xmlstarlet exited with code ${code}: ${errorOutput}`);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    const trimmed = output.trim();
    console.log("Extraction successful. Raw output:", trimmed);

    if (asArray) {
      // split on newlines, filter out any empty strings
      const arr = trimmed === ''
        ? []
        : trimmed.split(/\r?\n/).filter(line => line.length > 0);
      console.log("Returning as array:", arr);
      return res.json({ result: arr });
    } else {
      return res.json({ result: trimmed });
    }
  });
});

/* ========================
   /validate endpoint
   Expected input: XML file (.xml)
======================== */
app.post('/xmlvalidate', (req, res) => {
  console.log("=== /validate endpoint called ===");
  console.log("Request body:", req.body);
  let { filePath } = req.body;
  console.log("Received filePath for validation:", filePath);

  filePath = transformPath(filePath);
  console.log("Transformed filePath for validation:", filePath);

  // Check file extension (expect .xml)
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.xml') {
    console.error(`Invalid input file extension: ${ext}. Expected .xml`);
    return res.status(400).json({ error: 'Invalid input file extension. Expected .xml' });
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'File does not exist.' });
  }

  const args = ['val', filePath];
  console.log("Executing xmlstarlet for validation with args:", args);
  const child = spawn('xmlstarlet', args);
  let output = '', errorOutput = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { errorOutput += data; });
  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`Validation failed with code ${code}: ${errorOutput}`);
      return res.status(500).json({ valid: false, error: errorOutput.trim() });
    }
    console.log("Validation successful. Message:", output.trim());
    res.json({ valid: true, message: output.trim() });
  });
});

/* ========================
   /transform endpoint
   Expected input: 
     - xmlFilePath: XML file (.xml)
     - xsltFilePath: XSLT file (.xslt)
======================== */
app.post('/xmltransform', (req, res) => {
  console.log("=== /transform endpoint called ===");
  console.log("Request body:", req.body);
  let { xmlFilePath, xsltFilePath } = req.body;
  console.log("Received xmlFilePath:", xmlFilePath, "and xsltFilePath:", xsltFilePath);

  xmlFilePath = transformPath(xmlFilePath);
  xsltFilePath = transformPath(xsltFilePath);
  console.log("Transformed xmlFilePath:", xmlFilePath, "and xsltFilePath:", xsltFilePath);

  // Check input extensions
  const extXml = path.extname(xmlFilePath).toLowerCase();
  if (extXml !== '.xml') {
    console.error(`Invalid XML file extension: ${extXml}. Expected .xml`);
    return res.status(400).json({ error: 'Invalid XML file extension. Expected .xml' });
  }
  const extXslt = path.extname(xsltFilePath).toLowerCase();
  if (extXslt !== '.xslt') {
    console.error(`Invalid XSLT file extension: ${extXslt}. Expected .xslt`);
    return res.status(400).json({ error: 'Invalid XSLT file extension. Expected .xslt' });
  }

  if (!fs.existsSync(xmlFilePath)) {
    console.error(`XML file does not exist at path: ${xmlFilePath}`);
    return res.status(400).json({ error: 'XML file does not exist.' });
  }
  if (!fs.existsSync(xsltFilePath)) {
    console.error(`XSLT file does not exist at path: ${xsltFilePath}`);
    return res.status(400).json({ error: 'XSLT file does not exist.' });
  }

  const args = ['tr', xsltFilePath, xmlFilePath];
  console.log("Executing xmlstarlet transformation with args:", args);
  const child = spawn('xmlstarlet', args);
  let output = '', errorOutput = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { errorOutput += data; });
  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`Transformation failed with code ${code}: ${errorOutput}`);
      return res.status(500).json({ error: 'Transformation error', details: errorOutput.trim() });
    }
    console.log("Transformation successful. Result:", output.trim());
    res.json({ result: output.trim() });
  });
});

/* ========================
   /format endpoint
   Expected input: XML file (.xml)
======================== */
app.post('/xmlformat', (req, res) => {
  console.log("=== /format endpoint called ===");
  let { filePath, saveTo, logToConsole, viaUrl = false } = req.body;

  logToConsole = logToConsole === true;
  console.log({ filePath, saveTo, logToConsole, viaUrl });

  filePath = transformPath(filePath);
  if (!filePath.toLowerCase().endsWith('.xml')) {
    return res.status(400).json({ error: 'Expected a .xml file' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Source file does not exist.' });
  }

  // Decide if we should write to disk
  const shouldWrite = viaUrl || (saveTo && saveTo.trim() !== '');
  // Default filename if client didn’t provide one
  const baseName = path.basename(filePath, '.xml');
  const defaultName = `${baseName}_formatted.xml`;

  // Pick the actual file name & directory
  const outputName = (saveTo && saveTo.trim()) ? saveTo : defaultName;
  const outputDir  = viaUrl
    ? DOWNLOAD_DIR
    : path.dirname(filePath);
  const outputPath = path.join(outputDir, outputName);

  // Run xmlstarlet fo
  const child = spawn('xmlstarlet', ['fo', filePath]);
  let out = '', errBuf = '';
  child.stdout.on('data', d => { if (logToConsole) console.log(d.toString()); out += d; });
  child.stderr.on('data', d => { console.error(d.toString()); errBuf += d; });

  child.on('close', code => {
    if (code !== 0) {
      return res.status(500).json({ error: 'Formatting failed', details: errBuf.trim() });
    }
    out = out.trim();
    if (shouldWrite) {
      fs.writeFile(outputPath, out, writeErr => {
        if (writeErr) {
          return res.status(500).json({ error: 'Failed to save file', details: writeErr.message });
        }
        if (viaUrl) {
          const url = `${req.protocol}://${req.get('host')}/download/${outputName}`;
          return res.json({ message: 'Formatted XML saved.', downloadUrl: url, outputFile: outputName });
        } else {
          return res.json({ inputFile: path.basename(filePath), outputFile: outputName });
        }
      });
    } else {
      return res.json({ result: out });
    }
  });
});

/* ========================
   /removedtp endpoint
   Expected input: 
     {
       filePath:   string,
       saveTo?:    string,
       logToConsole?: boolean,
       viaUrl?:    boolean      // ← NEW: default false
     }
======================== */
app.post('/removedtp', (req, res) => {
  console.log("=== /removedtp endpoint called ===");
  console.log("Request body:", req.body);

  let { filePath, saveTo, logToConsole, viaUrl = false } = req.body;
  logToConsole = logToConsole === true;
  console.log("logToConsole:", logToConsole, "viaUrl:", viaUrl);

  // 1) Transform & validate
  filePath = transformPath(filePath);
  console.log("Transformed filePath:", filePath);
  if (!filePath.toLowerCase().endsWith('.xml')) {
    return res.status(400).json({ error: 'Invalid input extension; expected .xml' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Source XML file does not exist.' });
  }

  // 2) Decide output directory
  const baseName = path.basename(filePath, '.xml');
  const outputName = (saveTo && saveTo.trim()) 
    ? path.basename(saveTo) 
    : `${baseName}_removedDTP.xml`;
  const outputDir = viaUrl 
    ? DOWNLOAD_DIR               // serveable URL dir
    : path.dirname(filePath);    // alongside source
  const outputPath = path.join(outputDir, outputName);

  // 3) Run xmllint → writes directly via --output
  const args = [
    '--dropdtd',
    '--recover',
    '--encode', 'UTF-8',
    '--output', outputPath,
    filePath
  ];
  console.log('xmllint args:', args.join(' '));
  const child = spawn('xmllint', args);

  let stderr = '';
  child.stderr.on('data', d => stderr += d);

  child.on('close', code => {
    if (code !== 0) {
      console.error('xmllint failed:', stderr.trim());
      return res.status(500).json({
        error:   'Failed to strip DTD and write file.',
        details: stderr.trim()
      });
    }

    // sanity‐check zero‐byte
    try {
      const stats = fs.statSync(outputPath);
      if (stats.size === 0) throw new Error('zero-length');
    } catch (err) {
      console.error('Output file error:', err);
      return res.status(500).json({
        error: 'Output file is empty or inaccessible.'
      });
    }

    // 4a) viaUrl → return download URL
    if (viaUrl) {
      const host = req.get('host');
      const proto = req.protocol;
      const downloadUrl = `${proto}://${host}/download/${outputName}`;
      console.log(`Saved to ${outputPath}, URL: ${downloadUrl}`);
      return res.json({
        message:     'Cleaned XML saved internally.',
        downloadUrl,
        outputFile:  outputName
      });
    }

    // 4b) default → return filenames only
    console.log(`Saved alongside source: ${outputPath}`);
    return res.json({
      inputFile:  path.basename(filePath),
      outputFile: outputName
    });
  });
});

/* ========================
   /xmltojson endpoint
   Expected input: XML file (.xml)
======================== */
app.post('/xmltojson', (req, res) => {
  console.log("=== /xmltojson endpoint called ===");
  let { filePath, saveTo, logToConsole, viaUrl = false } = req.body;

  logToConsole = logToConsole === true;
  console.log({ filePath, saveTo, logToConsole, viaUrl });

  filePath = transformPath(filePath);
  if (!filePath.toLowerCase().endsWith('.xml')) {
    return res.status(400).json({ error: 'Expected a .xml file' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Source file does not exist.' });
  }

  const shouldWrite = viaUrl || (saveTo && saveTo.trim() !== '');
  const baseName    = path.basename(filePath, '.xml');
  const defaultName = `${baseName}.json`;
  const outputName  = (saveTo && saveTo.trim()) ? saveTo : defaultName;
  const outputDir   = viaUrl
    ? DOWNLOAD_DIR
    : path.dirname(filePath);
  const outputPath  = path.join(outputDir, outputName);

  const saxParser = sax.createStream(true, { trim: true, normalize: true });
  const records   = [];
  let current, field;

  saxParser
    .on('opentag', node => {
      if (node.name === 'OM_RECORD') current = {};
      else if (current && node.name === 'OM_FIELD') {
        field = node.attributes.FieldName;
        current[field] = '';
      }
    })
    .on('text', txt => { if (current && field) current[field] += txt; })
    .on('closetag', tag => {
      if (tag === 'OM_FIELD') field = null;
      else if (tag === 'OM_RECORD') {
        records.push(current);
        if (logToConsole) console.log('Record:', current);
        current = null;
      }
    })
    .on('error', e => res.status(500).json({ error: 'Parse error', details: e.message }))
    .on('end', () => {
      const out = JSON.stringify(records, null, 2);
      if (shouldWrite) {
        fs.writeFile(outputPath, out, e => {
          if (e) return res.status(500).json({ error: 'Save error', details: e.message });
          if (viaUrl) {
            const url = `${req.protocol}://${req.get('host')}/download/${outputName}`;
            return res.json({ message: 'JSON saved.', downloadUrl: url, outputFile: outputName });
          } else {
            return res.json({ inputFile: path.basename(filePath), outputFile: outputName });
          }
        });
      } else {
        return res.json({ result: out });
      }
    });

  // Kick off: transcode UTF-16→UTF-8 then pipe into SAX
  const iconv = spawn('iconv', ['-f','UTF-16','-t','UTF-8', filePath]);
  iconv.stdout.pipe(saxParser);
  iconv.stderr.on('data', d => console.error('iconv:', d.toString()));
  iconv.on('error', e => res.status(500).json({ error: 'Transcode error', details: e.message }));
});


/* ========================
   /jsontoxml endpoint
   Expected input: JSON file (.json)
======================== */
app.post('/jsontoxml', (req, res) => {
  console.log("=== /jsontoxml endpoint called ===");
  let { filePath, saveTo, logToConsole, viaUrl = false } = req.body;

  logToConsole = logToConsole === true;
  console.log({ filePath, saveTo, logToConsole, viaUrl });

  filePath = transformPath(filePath);
  if (!filePath.toLowerCase().endsWith('.json')) {
    return res.status(400).json({ error: 'Expected a .json file' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Source file does not exist.' });
  }

  const shouldWrite = viaUrl || (saveTo && saveTo.trim() !== '');
  const baseName    = path.basename(filePath, '.json');
  const defaultName = `${baseName}_converted.xml`;
  const outputName  = (saveTo && saveTo.trim()) ? saveTo : defaultName;
  const outputDir   = viaUrl 
    ? DOWNLOAD_DIR 
    : path.dirname(filePath);
  const outputPath  = path.join(outputDir, outputName);

  fs.readFile(filePath, 'utf8', (readErr, data) => {
    if (readErr) return res.status(500).json({ error: 'Read error', details: readErr.message });

    let xml;
    try {
      xml = new XMLBuilder().build(JSON.parse(data));
    } catch (buildErr) {
      return res.status(500).json({ error: 'Convert error', details: buildErr.message });
    }

    if (logToConsole) console.log(xml);

    if (shouldWrite) {
      fs.writeFile(outputPath, xml, writeErr => {
        if (writeErr) {
          return res.status(500).json({ error: 'Save error', details: writeErr.message });
        }
        if (viaUrl) {
          const url = `${req.protocol}://${req.get('host')}/download/${outputName}`;
          return res.json({ message: 'XML saved.', downloadUrl: url, outputFile: outputName });
        } else {
          return res.json({ inputFile: path.basename(filePath), outputFile: outputName });
        }
      });
    } else {
      return res.json({ result: xml });
    }
  });
});

/* ========================
   /jsonverify endpoint
   Expected input: JSON file (.json)
   Functionality: Reads the JSON file and returns whether it is valid.
======================== */
app.post('/jsonverify', (req, res) => {
  console.log("=== /jsonverify endpoint called ===");
  console.log("Request body:", req.body);
  let { filePath, logToConsole } = req.body;
  
  logToConsole = logToConsole === true;
  console.log("logToConsole is set to:", logToConsole);
  
  console.log("Received filePath for JSON verification:", filePath);
  filePath = transformPath(filePath);
  console.log("Transformed filePath for JSON verification:", filePath);
  
  // Check extension (expect .json)
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.json') {
    console.error(`Invalid input file extension: ${ext}. Expected .json`);
    return res.status(400).json({ valid: false, error: 'Invalid input file extension. Expected .json' });
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`Source JSON file does not exist at path: ${filePath}`);
    return res.status(400).json({ valid: false, error: 'Source JSON file does not exist.' });
  }
  
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading JSON file:", err);
      return res.status(500).json({ valid: false, error: 'Error reading JSON file', details: err.message });
    }
    try {
      JSON.parse(data);
      console.log("JSON is valid.");
      res.json({ valid: true, message: "Valid JSON" });
    } catch (parseErr) {
      console.error("Invalid JSON:", parseErr);
      res.status(400).json({ valid: false, error: "Invalid JSON", details: parseErr.message });
    }
  });
});

/* ========================
   /jsonformat endpoint
   Expected input: JSON file (.json)
   Functionality: Attempts to pretty-print the JSON.
     - If the JSON is valid, returns (or saves) the formatted version.
     - If the JSON is invalid, attempts to repair it with jsonrepair.
======================== */
app.post('/jsonformat', (req, res) => {
  console.log("=== /jsonformat endpoint called ===");
  let { filePath, saveTo, logToConsole, viaUrl = false } = req.body;

  logToConsole = logToConsole === true;
  console.log({ filePath, saveTo, logToConsole, viaUrl });

  filePath = transformPath(filePath);
  if (!filePath.toLowerCase().endsWith('.json')) {
    return res.status(400).json({ error: 'Expected a .json file' });
  }
  if (!fs.existsSync(filePath)) {
    return res.status(400).json({ error: 'Source file does not exist.' });
  }

  const shouldWrite = viaUrl || (saveTo && saveTo.trim() !== '');
  const baseName    = path.basename(filePath, '.json');
  const defaultName = `${baseName}_formatted.json`;
  const outputName  = (saveTo && saveTo.trim()) ? saveTo : defaultName;
  const outputDir   = viaUrl 
    ? DOWNLOAD_DIR 
    : path.dirname(filePath);
  const outputPath  = path.join(outputDir, outputName);

  fs.readFile(filePath, 'utf8', (readErr, data) => {
    if (readErr) return res.status(500).json({ error: 'Read error', details: readErr.message });

    let fixed;
    try {
      fixed = JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      try {
        fixed = jsonrepair(data);
        JSON.parse(fixed);
      } catch (repairErr) {
        return res.status(400).json({ error: 'Invalid JSON', details: repairErr.message });
      }
    }

    if (logToConsole) console.log(fixed);

    if (shouldWrite) {
      fs.writeFile(outputPath, fixed, writeErr => {
        if (writeErr) {
          return res.status(500).json({ error: 'Save error', details: writeErr.message });
        }
        if (viaUrl) {
          const url = `${req.protocol}://${req.get('host')}/download/${outputName}`;
          return res.json({ message: 'JSON saved.', downloadUrl: url, outputFile: outputName });
        } else {
          return res.json({ inputFile: path.basename(filePath), outputFile: outputName });
        }
      });
    } else {
      return res.json({ result: fixed });
    }
  });
});

/* ========================
   /jsonextract endpoint
   Expected input: JSON file (.json), a key to extract, and an optional index.
   Functionality: Extracts the value(s) corresponding to the specified key.
   If the extracted value is an array (and it's the only occurrence), it is unwrapped.
   If an index is provided:
     - If index is -1, returns all available values.
     - Otherwise, returns only the element at that index.
======================== */
app.post('/jsonextract', (req, res) => {
  console.log("=== /jsonextract endpoint called ===");
  console.log("Request body:", req.body);
  let { filePath, key, logToConsole } = req.body;
  let { index } = req.body; // Optional index parameter

  logToConsole = logToConsole === true;
  console.log("Received filePath for JSON extraction:", filePath);
  console.log("Key to extract:", key);
  if (index !== undefined) {
    console.log("Requested index:", index);
  }

  // Transform file path for internal mapping
  filePath = transformPath(filePath);
  console.log("Transformed filePath for JSON extraction:", filePath);

  // Check that the input file has a .json extension
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.json') {
    console.error(`Invalid input file extension: ${ext}. Expected .json`);
    return res.status(400).json({ error: 'Invalid input file extension. Expected .json' });
  }

  if (!fs.existsSync(filePath)) {
    console.error(`Source JSON file does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'Source JSON file does not exist.' });
  }

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading JSON file:", err);
      return res.status(500).json({ error: 'Error reading JSON file', details: err.message });
    }
    let jsonObj;
    try {
      jsonObj = JSON.parse(data);
    } catch (parseErr) {
      console.error("Error parsing JSON:", parseErr);
      return res.status(500).json({ error: 'Error parsing JSON', details: parseErr.message });
    }

    // Validate the key parameter
    if (!key || typeof key !== 'string') {
      console.error("Invalid key parameter:", key);
      return res.status(400).json({ error: 'Invalid key parameter.' });
    }

    // Recursive function to extract all occurrences of the specified key
    function extractKey(obj, targetKey) {
      let results = [];
      if (typeof obj === 'object' && obj !== null) {
        if (obj.hasOwnProperty(targetKey)) {
          results.push(obj[targetKey]);
        }
        for (let prop in obj) {
          if (typeof obj[prop] === 'object') {
            results = results.concat(extractKey(obj[prop], targetKey));
          }
        }
      }
      return results;
    }

    let extractedValues = extractKey(jsonObj, key);
    if (logToConsole) {
      console.log("Extracted values for key", key, ":", extractedValues);
    }

    if (extractedValues.length === 0) {
      console.error("Key not found:", key);
      return res.status(400).json({ error: `Key '${key}' not found in JSON file.` });
    }

    // If a single occurrence is found and it is an array, unwrap it.
    if (extractedValues.length === 1 && Array.isArray(extractedValues[0])) {
      extractedValues = extractedValues[0];
    }

    // If an index is provided, check its value.
    if (index !== undefined) {
      let idx = index;
      if (typeof idx !== 'number') {
        idx = parseInt(idx, 10);
      }
      if (isNaN(idx)) {
        console.error("Invalid index parameter:", index);
        return res.status(400).json({ error: 'Invalid index parameter. It must be a number.' });
      }
      // If index is -1, return all available values.
      if (idx === -1) {
        return res.json({ result: extractedValues });
      }
      if (idx < 0 || idx >= extractedValues.length) {
        console.error("Index out of range:", idx);
        return res.status(400).json({ error: 'Index out of range.' });
      }
      return res.json({ result: extractedValues[idx] });
    }

    // Return a single value if only one match is found, otherwise return the array of values.
    let resultToReturn = extractedValues.length === 1 ? extractedValues[0] : extractedValues;
    return res.json({ result: resultToReturn });
  });
});

const PORT = process.env.PORT || 3000;
let version = "unknown";

try {
  const versionData = fs.readFileSync('./version.json', 'utf8');
  const versionJson = JSON.parse(versionData);
  version = versionJson.version || version;
} catch (err) {
  console.error("Error reading version.json:", err);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}, version: ${version}`);
});