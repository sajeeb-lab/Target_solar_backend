import type { VercelRequest, VercelResponse } from '@vercel/node';

// Proxies the OpenSolar project lookup so the API key stays server-side.
// If the frontend called OpenSolar directly, the bearer token would be
// visible to anyone who opens DevTools.

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function setCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { projectNumber } = (req.body || {}) as { projectNumber?: string | number };

    // Digits only — the value goes straight into a URL path, so this also
    // prevents anything path-traversal-ish being injected.
    if (projectNumber === undefined || !/^\d+$/.test(String(projectNumber))) {
      return res.status(400).json({ valid: false, error: 'Invalid project number format' });
    }

    const orgId = process.env.OPENSOLAR_ORG_ID;
    const apiKey = process.env.OPENSOLAR_API_KEY;

    if (!orgId || !apiKey) {
      console.error('OpenSolar env vars not configured');
      return res.status(500).json({ valid: false, error: 'Unable to verify project number.' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(
        `https://api.opensolar.com/api/orgs/${orgId}/projects/${String(projectNumber)}/`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    // 200 = project exists in this org. Returned as HTTP 200 with valid:true.
    if (response.status === 200) {
      return res.status(200).json({ valid: true });
    }

    // 404 = checked successfully, project doesn't exist. Still HTTP 200 —
    // "we checked and it isn't there" is a successful check, so the frontend
    // can tell it apart from "our verification is broken".
    if (response.status === 404) {
      return res.status(200).json({ valid: false });
    }

    // 401/403 = our API key is wrong/expired. 5xx = OpenSolar is down.
    // Either way it's not the customer's fault, so don't tell them their
    // project number is wrong.
    console.error('OpenSolar returned unexpected status:', response.status);
    return res
      .status(502)
      .json({ valid: false, error: 'Unable to verify project number right now.' });
  } catch (error) {
    console.error('Project validation failed:', error);
    return res
      .status(502)
      .json({ valid: false, error: 'Unable to verify project number right now.' });
  }
}
