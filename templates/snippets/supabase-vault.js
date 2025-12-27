/**
 * Supabase Vault Snippet
 * Lookup secrets from GARZA OS vault
 */

const SUPABASE_URL = 'https://vbwhhmdudzigolwhklal.supabase.co';
// Get key from Craft doc 7061 or env
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function getSecret(name) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_secret`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ secret_name: name })
  });
  
  if (!res.ok) throw new Error(`Vault error: ${res.status}`);
  const data = await res.json();
  return data?.decrypted_secret || null;
}

async function listSecrets(category = null) {
  const url = category 
    ? `${SUPABASE_URL}/rest/v1/vault_secrets?category=eq.${category}&select=name,category`
    : `${SUPABASE_URL}/rest/v1/vault_secrets?select=name,category`;
    
  const res = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  
  return res.json();
}

// Usage:
// const apiKey = await getSecret('claude_api_key');
// const aiSecrets = await listSecrets('ai');

module.exports = { getSecret, listSecrets };
