// @ts-expect-error — JS module, no declaration file
import { getCorsHeaders } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { jsonResponse } from './_json-response.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export const config = { runtime: 'nodejs' };

export default async function handler(req: Request): Promise<Response> {
  const cors = getCorsHeaders(req, 'POST, OPTIONS') as Record<string, string>;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  try {
    let body: { name?: string; type?: string; data?: string };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
    }

    const { name, type, data } = body;
    if (!name || !type || !data) {
      return jsonResponse({ error: 'Missing name, type, or data' }, 400, cors);
    }

    // Determine target directory: public/repo
    const repoPath = path.resolve((process as any).cwd(), 'public', 'repo', type);
    
    // Create directory recursively
    await fs.mkdir(repoPath, { recursive: true });

    const filePath = path.join(repoPath, name);

    if (type === 'image' || type === 'pdf') {
      const base64Data = data.replace(/^data:[^;]+;base64,/, '');
      await fs.writeFile(filePath, Buffer.from(base64Data, 'base64'));
    } else if (type === 'json') {
      const jsonContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
      await fs.writeFile(filePath, jsonContent, 'utf-8');
    } else {
      await fs.writeFile(filePath, data, 'utf-8');
    }

    return jsonResponse({ 
      success: true, 
      message: 'File saved successfully to local repository!',
      path: filePath,
      url: `/repo/${type}/${name}`
    }, 200, cors);
  } catch (error: any) {
    console.error('[store-intel] Error saving file:', error);
    return jsonResponse({ error: 'Failed to write file to disk', details: error.message }, 500, cors);
  }
}
