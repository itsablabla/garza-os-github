/**
 * Fly.io API Snippet
 * Manage apps, machines, secrets programmatically
 */

const FLY_API = 'https://api.machines.dev/v1';
// Get token: fly auth token
const FLY_TOKEN = process.env.FLY_API_TOKEN;

const headers = {
  'Authorization': `Bearer ${FLY_TOKEN}`,
  'Content-Type': 'application/json'
};

// List all apps
async function listApps(orgSlug = 'personal') {
  const res = await fetch(`${FLY_API}/apps?org_slug=${orgSlug}`, { headers });
  return res.json();
}

// Get app details
async function getApp(appName) {
  const res = await fetch(`${FLY_API}/apps/${appName}`, { headers });
  return res.json();
}

// List machines in app
async function listMachines(appName) {
  const res = await fetch(`${FLY_API}/apps/${appName}/machines`, { headers });
  return res.json();
}

// Restart machine
async function restartMachine(appName, machineId) {
  const res = await fetch(`${FLY_API}/apps/${appName}/machines/${machineId}/restart`, {
    method: 'POST',
    headers
  });
  return res.json();
}

// Stop machine
async function stopMachine(appName, machineId) {
  const res = await fetch(`${FLY_API}/apps/${appName}/machines/${machineId}/stop`, {
    method: 'POST',
    headers
  });
  return res.json();
}

// Start machine
async function startMachine(appName, machineId) {
  const res = await fetch(`${FLY_API}/apps/${appName}/machines/${machineId}/start`, {
    method: 'POST',
    headers
  });
  return res.json();
}

// Set secret (requires redeploy)
async function setSecret(appName, key, value) {
  const res = await fetch(`${FLY_API}/apps/${appName}/secrets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ [key]: value })
  });
  return res.json();
}

// Health check
async function checkHealth(appName, path = '/health') {
  try {
    const res = await fetch(`https://${appName}.fly.dev${path}`, {
      timeout: 5000
    });
    return { status: res.status, ok: res.ok };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

module.exports = { 
  listApps, getApp, listMachines, 
  restartMachine, stopMachine, startMachine,
  setSecret, checkHealth 
};
