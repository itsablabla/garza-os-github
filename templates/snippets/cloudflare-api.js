/**
 * Cloudflare API Snippet
 * DNS, Workers, and zone management
 */

const CF_API = 'https://api.cloudflare.com/client/v4';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const GARZAHIVE_ZONE = '9c70206ce57d506d1d4e9397f6bb8ebc';

const headers = {
  'Authorization': `Bearer ${CF_TOKEN}`,
  'Content-Type': 'application/json'
};

// ===== DNS =====

async function listDnsRecords(zoneId = GARZAHIVE_ZONE) {
  const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, { headers });
  return res.json();
}

async function createDnsRecord(name, target, type = 'CNAME', zoneId = GARZAHIVE_ZONE) {
  const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type,
      name,  // e.g., "api" for api.garzahive.com
      content: target,  // e.g., "my-app.fly.dev"
      proxied: false,  // must be false for Fly certs
      ttl: 1  // auto
    })
  });
  return res.json();
}

async function deleteDnsRecord(recordId, zoneId = GARZAHIVE_ZONE) {
  const res = await fetch(`${CF_API}/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'DELETE',
    headers
  });
  return res.json();
}

// ===== Workers =====

async function listWorkers(accountId) {
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts`, { headers });
  return res.json();
}

async function deployWorker(accountId, scriptName, code) {
  const formData = new FormData();
  formData.append('script', new Blob([code], { type: 'application/javascript' }));
  
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${scriptName}`, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${CF_TOKEN}` },
    body: formData
  });
  return res.json();
}

// ===== KV =====

async function kvGet(accountId, namespaceId, key) {
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`,
    { headers }
  );
  return res.text();
}

async function kvPut(accountId, namespaceId, key, value) {
  const res = await fetch(
    `${CF_API}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`,
    {
      method: 'PUT',
      headers,
      body: value
    }
  );
  return res.json();
}

module.exports = {
  listDnsRecords, createDnsRecord, deleteDnsRecord,
  listWorkers, deployWorker,
  kvGet, kvPut,
  GARZAHIVE_ZONE
};
