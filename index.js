const fs = require('fs');
const path = require('path');
const express = require('express');
const { spawn } = require('child_process');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const { XMLParser, XMLBuilder } = require("fast-xml-parser");
const { jsonrepair } = require('jsonrepair');
const app = express();

app.use(express.json());

// Load your Swagger document (adjust the path as needed)
const swaggerDocument = YAML.load('./swagger.yaml');

// Serve Swagger UI at /api
app.use('/api', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
// Serve the raw swagger.yaml file at /api/swagger
app.get('/swagger', (req, res) => {
  res.sendFile(path.join(__dirname, './swagger.yaml'));
});

// Define a directory for downloads (internal to the container)
const DOWNLOAD_DIR = '/app/downloads';
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  console.log(`Created downloads directory: ${DOWNLOAD_DIR}`);
}
app.use('/download', express.static(DOWNLOAD_DIR));

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

/* ========================
   /extract endpoint
   Expected input: XML file (.xml)
======================== */
app.post('/extract', (req, res) => {
  console.log("=== /extract endpoint called ===");
  console.log("Request body:", req.body);
  let { filePath, xpath } = req.body;
  console.log("Received filePath:", filePath);

  // Transform file path for processing
  filePath = transformPath(filePath);
  console.log("Transformed filePath for processing:", filePath);

  // Check file extension (expect .xml)
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.xml') {
    console.error(`Invalid input file extension: ${ext}. Expected .xml`);
    return res.status(400).json({ error: 'Invalid input file extension. Expected .xml' });
  }

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

  // Execute xmlstarlet extraction
  const args = ['sel', '-t', '-v', xpath, filePath];
  console.log("Executing xmlstarlet with args:", args);
  const child = spawn('xmlstarlet', args);
  let output = '';
  let errorOutput = '';
  child.stdout.on('data', (data) => { output += data; });
  child.stderr.on('data', (data) => { errorOutput += data; });
  child.on('close', (code) => {
    if (code !== 0) {
      console.error(`xmlstarlet exited with code ${code}: ${errorOutput}`);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
    console.log("Extraction successful. Output:", output.trim());
    res.json({ result: output.trim() });
  });
});

/* ========================
   /validate endpoint
   Expected input: XML file (.xml)
======================== */
app.post('/validate', (req, res) => {
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
app.post('/transform', (req, res) => {
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
app.post('/format', (req, res) => {
  console.log("=== /format endpoint called ===");
  console.log("Request body:", req.body);
  let { filePath, saveTo, logToConsole } = req.body;
  
  logToConsole = logToConsole === true;
  console.log("logToConsole is set to:", logToConsole);
  console.log("Received filePath for formatting:", filePath);
  if (saveTo) console.log("Received saveTo path:", saveTo);

  filePath = transformPath(filePath);
  console.log("Transformed filePath for formatting:", filePath);

  // Check extension for input file (expect .xml)
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.xml') {
    console.error(`Invalid input file extension: ${ext}. Expected .xml`);
    return res.status(400).json({ error: 'Invalid input file extension. Expected .xml' });
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`Source file does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'Source file does not exist.' });
  }

  let createDownload = false;
  let downloadFilePath = '';
  let downloadFileName = '';
  if (saveTo && saveTo.trim() !== '') {
    // For /format, we expect the input to be XML.
    // Optionally, if saveTo is provided, we don't check its extension here since the internal file can have any name.
    downloadFileName = path.basename(saveTo);
    downloadFilePath = path.join(DOWNLOAD_DIR, downloadFileName);
    console.log("Download file will be saved as:", downloadFilePath);
    createDownload = true;
  }

  const args = ['fo', filePath];
  console.log("Executing xmlstarlet formatting with args:", args);
  const child = spawn('xmlstarlet', args);
  let output = '', errorOutput = '';
  child.stdout.on('data', (data) => {
    if (logToConsole) console.log("Formatting stdout data:", data.toString());
    output += data;
  });
  child.stderr.on('data', (data) => {
    console.log("Formatting stderr data:", data.toString());
    errorOutput += data;
  });
  child.on('error', (err) => { console.error("Child process error:", err); });
  child.on('close', (code) => {
    console.log("Child process closed with code:", code);
    if (code !== 0) {
      console.error(`xmlstarlet formatting failed with code ${code}: ${errorOutput}`);
      return res.status(500).json({ error: 'Formatting error', details: errorOutput.trim() });
    }
    output = output.trim();
    if (logToConsole) console.log("Final formatted output:\n", output);
    if (createDownload) {
      fs.writeFile(downloadFilePath, output, (err) => {
        if (err) {
          console.error('Error writing formatted file:', err);
          return res.status(500).json({ error: 'Failed to save file', details: err.message });
        }
        console.log(`Formatted XML saved internally as ${downloadFilePath}`);
        const host = req.get('host');
        const protocol = req.protocol;
        const downloadUrl = `${protocol}://${host}/download/${downloadFileName}`;
        res.json({ message: "Formatted XML saved internally.", downloadUrl });
      });
    } else {
      console.log("Returning formatted XML in response.");
      res.json({ result: output });
    }
  });
});

/* ========================
   /xmltojson endpoint
   Expected input: XML file (.xml)
======================== */
app.post('/xmltojson', (req, res) => {
  console.log("=== /xmltojson endpoint called ===");
  console.log("Request body:", req.body);
  let { filePath, saveTo, logToConsole } = req.body;
  
  logToConsole = logToConsole === true;
  console.log("logToConsole is set to:", logToConsole);
  console.log("Received filePath for XML to JSON conversion:", filePath);
  if (saveTo) console.log("Received saveTo path:", saveTo);
  
  filePath = transformPath(filePath);
  console.log("Transformed filePath for XML to JSON conversion:", filePath);
  
  // Check extension for input file (expect .xml)
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.xml') {
    console.error(`Invalid input file extension: ${ext}. Expected .xml`);
    return res.status(400).json({ error: 'Invalid input file extension. Expected .xml' });
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`Source XML file does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'Source XML file does not exist.' });
  }
  
  // If saveTo is provided, check that its extension is ".json"
  if (saveTo && saveTo.trim() !== "") {
    const saveExt = path.extname(saveTo).toLowerCase();
    if (saveExt !== ".json") {
      console.error(`Invalid saveTo file extension: ${saveExt}. Expected .json`);
      return res.status(400).json({ error: 'Invalid saveTo file extension. Expected .json for XML to JSON conversion.' });
    }
  }
  
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error("Error reading XML file:", err);
      return res.status(500).json({ error: 'Error reading XML file', details: err.message });
    }
    let jsonObj;
    try {
      const parser = new XMLParser();
      jsonObj = parser.parse(data);
    } catch (parseErr) {
      console.error("Error parsing XML:", parseErr);
      return res.status(500).json({ error: 'Error parsing XML', details: parseErr.message });
    }
    const jsonOutput = JSON.stringify(jsonObj, null, 2);
    if (logToConsole) console.log("Converted JSON output:\n", jsonOutput);
    if (saveTo && saveTo.trim() !== "") {
      const downloadFileName = path.basename(saveTo);
      const downloadFilePath = path.join(DOWNLOAD_DIR, downloadFileName);
      fs.writeFile(downloadFilePath, jsonOutput, (err) => {
        if (err) {
          console.error("Error writing JSON file:", err);
          return res.status(500).json({ error: 'Failed to save JSON file', details: err.message });
        }
        console.log(`Converted JSON saved internally as ${downloadFilePath}`);
        const host = req.get('host');
        const protocol = req.protocol;
        const downloadUrl = `${protocol}://${host}/download/${downloadFileName}`;
        res.json({ message: "Converted JSON saved internally.", downloadUrl });
      });
    } else {
      res.json({ result: jsonOutput });
    }
  });
});

/* ========================
   /jsontoxml endpoint
   Expected input: JSON file (.json)
======================== */
app.post('/jsontoxml', (req, res) => {
  console.log("=== /jsontoxml endpoint called ===");
  console.log("Request body:", req.body);
  let { filePath, saveTo, logToConsole } = req.body;
  
  logToConsole = logToConsole === true;
  console.log("logToConsole is set to:", logToConsole);
  console.log("Received filePath for JSON to XML conversion:", filePath);
  if (saveTo) console.log("Received saveTo path:", saveTo);
  
  filePath = transformPath(filePath);
  console.log("Transformed filePath for JSON to XML conversion:", filePath);
  
  // Check extension for input file (expect .json)
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.json') {
    console.error(`Invalid input file extension: ${ext}. Expected .json`);
    return res.status(400).json({ error: 'Invalid input file extension. Expected .json' });
  }
  
  if (!fs.existsSync(filePath)) {
    console.error(`Source JSON file does not exist at path: ${filePath}`);
    return res.status(400).json({ error: 'Source JSON file does not exist.' });
  }
  
  // If saveTo is provided, check that its extension is ".xml"
  if (saveTo && saveTo.trim() !== "") {
    const saveExt = path.extname(saveTo).toLowerCase();
    if (saveExt !== ".xml") {
      console.error(`Invalid saveTo file extension: ${saveExt}. Expected .xml`);
      return res.status(400).json({ error: 'Invalid saveTo file extension. Expected .xml for JSON to XML conversion.' });
    }
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
    let xmlOutput;
    try {
      const builder = new XMLBuilder();
      xmlOutput = builder.build(jsonObj);
    } catch (buildErr) {
      console.error("Error building XML:", buildErr);
      return res.status(500).json({ error: 'Error building XML', details: buildErr.message });
    }
    if (logToConsole) console.log("Converted XML output:\n", xmlOutput);
    if (saveTo && saveTo.trim() !== "") {
      const downloadFileName = path.basename(saveTo);
      const downloadFilePath = path.join(DOWNLOAD_DIR, downloadFileName);
      fs.writeFile(downloadFilePath, xmlOutput, (err) => {
        if (err) {
          console.error("Error writing XML file:", err);
          return res.status(500).json({ error: 'Failed to save XML file', details: err.message });
        }
        console.log(`Converted XML saved internally as ${downloadFilePath}`);
        const host = req.get('host');
        const protocol = req.protocol;
        const downloadUrl = `${protocol}://${host}/download/${downloadFileName}`;
        res.json({ message: "Converted XML saved internally.", downloadUrl });
      });
    } else {
      res.json({ result: xmlOutput });
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
  console.log("Request body:", req.body);
  let { filePath, saveTo, logToConsole } = req.body;
  
  logToConsole = logToConsole === true;
  console.log("logToConsole is set to:", logToConsole);
  
  console.log("Received filePath for JSON formatting:", filePath);
  if (saveTo) console.log("Received saveTo path:", saveTo);
  
  filePath = transformPath(filePath);
  console.log("Transformed filePath for JSON formatting:", filePath);
  
  // Check extension (expect .json)
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
    let correctedJson;
    try {
      // Try to parse the JSON normally
      const jsonObj = JSON.parse(data);
      correctedJson = JSON.stringify(jsonObj, null, 2);
      console.log("JSON parsed successfully.");
    } catch (parseErr) {
      console.error("JSON parsing failed, attempting repair:", parseErr);
      try {
        // Attempt to repair the JSON using jsonrepair
        correctedJson = jsonrepair(data);
        // Test the repaired JSON by parsing it
        JSON.parse(correctedJson);
        console.log("JSON repair successful.");
      } catch (repairErr) {
        console.error("JSON repair failed:", repairErr);
        return res.status(400).json({ error: 'JSON is invalid and could not be repaired.', details: repairErr.message });
      }
    }
    
    if (logToConsole) {
      console.log("Corrected JSON output:\n", correctedJson);
    }
    
    if (saveTo && saveTo.trim() !== "") {
      // Check that saveTo extension is .json
      const saveExt = path.extname(saveTo).toLowerCase();
      if (saveExt !== ".json") {
        console.error(`Invalid saveTo file extension: ${saveExt}. Expected .json`);
        return res.status(400).json({ error: 'Invalid saveTo file extension. Expected .json for JSON formatting.' });
      }
      const downloadFileName = path.basename(saveTo);
      const downloadFilePath = path.join(DOWNLOAD_DIR, downloadFileName);
      fs.writeFile(downloadFilePath, correctedJson, (err) => {
        if (err) {
          console.error("Error writing corrected JSON file:", err);
          return res.status(500).json({ error: 'Failed to save corrected JSON file', details: err.message });
        }
        console.log(`Corrected JSON saved internally as ${downloadFilePath}`);
        const host = req.get('host');
        const protocol = req.protocol;
        const downloadUrl = `${protocol}://${host}/download/${downloadFileName}`;
        res.json({ message: "Corrected JSON saved internally.", downloadUrl });
      });
    } else {
      res.json({ result: correctedJson });
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});