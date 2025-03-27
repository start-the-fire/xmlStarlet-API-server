const fs = require('fs');
const path = require('path');
const packageJson = require('../package.json');
const versionJsonPath = path.join(__dirname, '../version.json');

// Function to bump the minor version (e.g., 1.0.0 -> 1.1.0)
function bumpVersion(version) {
  const parts = version.split('.');
  if (parts.length !== 3) {
    throw new Error(`Invalid version format: ${version}`);
  }
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  // Increase minor version, reset patch to 0
  return `${major}.${minor + 1}.0`;
}

// Load existing version.json or create a new object if not present
let versionData = {};
try {
  versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
} catch (err) {
  console.error('Error reading version.json. Creating a new one.');
  versionData = { version: '', changelog: [] };
}

// Determine the current version: if versionData exists use that, otherwise use package.json
const currentVersion = versionData.version || packageJson.version;

// Bump the version by increasing the minor version
const newVersion = bumpVersion(currentVersion);

// Update the version field in versionData
versionData.version = newVersion;

// Get the current date in YYYY-MM-DD format
const currentDate = new Date().toISOString().split('T')[0];

// Add a new changelog entry if one doesn't already exist for the new version
if (!versionData.changelog.some(entry => entry.version === newVersion)) {
  versionData.changelog.unshift({
    version: newVersion,
    date: currentDate,
    changes: [
      "", // Default entry line 1 (update with your changelog details)
      ""  // Default entry line 2
    ],
  });
}

// Write the updated version.json file with pretty-printing
try {
  fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2));
  console.log(`Updated version.json to version ${newVersion}`);
} catch (writeError) {
  console.error('Error writing version.json:', writeError);
}