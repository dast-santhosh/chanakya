// @ts-expect-error — JS module, no declaration file
import { getCorsHeaders } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { jsonResponse } from './_json-response.js';
import { callLlm } from '../server/_shared/llm';
import { sanitizeForPrompt } from '../server/_shared/llm-sanitize.js';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const cors = getCorsHeaders(req, 'POST, OPTIONS') as Record<string, string>;

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  try {
    let body: {
      mode?: string;
      context?: string;
      userComment?: string;
      type?: string;
      clickedNodeId?: string;
      existingNodes?: Array<{ id: string; label: string; type: string }>;
      nodes?: Array<{ label: string; type: string; definition: string }>;
    };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, cors);
    }

    const mode = body.mode;
    if (mode === 'generate') {
      const { context, userComment, type, clickedNodeId, existingNodes } = body;
      if (!context || !userComment || !type || !clickedNodeId) {
        return jsonResponse({ error: 'Missing context, userComment, type, or clickedNodeId' }, 400, cors);
      }

      const cleanContext = sanitizeForPrompt(context) ?? '';
      const cleanComment = sanitizeForPrompt(userComment) ?? '';
      const cleanExisting = Array.isArray(existingNodes) 
        ? existingNodes.map(n => `- [${n.type}] ${n.label} (ID: ${n.id})`).join('\n')
        : 'None';

      const prompt = `You are Chanakya's tactical mapping AI. An analyst has requested expanding on the current geopolitical intelligence map.

CURRENT INTELLIGENCE CONTEXT PATH (from root node to active clicked tail node):
${cleanContext}

CLICKED NODE TYPE: ${type}
CLICKED NODE ID: ${clickedNodeId}

EXISTING GRAPH NODES (DO NOT RE-GENERATE OR DUPLICATE THESE):
${cleanExisting}

ANALYST INSTRUCTION/COMMENT:
"${cleanComment}"

Based on this input, generate exactly 1 or 2 new highly relevant, realistic connected nodes and connections to map this event further.
You MUST return ONLY a valid, raw JSON object matching the following structure (no code fences, no extra text, must be parseable by JSON.parse):
{
  "nodes": [
    { "id": "node-${Math.floor(1000 + Math.random() * 9000)}-ext", "label": "Short Title", "type": "Intel|Place|People|Location|News|Feed", "definition": "Brief intelligence description" }
  ],
  "edges": [
    { "from": "string-parent-id", "to": "string-child-id", "label": "relationship verb" }
  ]
}

Requirements:
1. Generate exactly 1 or 2 new logical nodes.
2. At least one edge MUST connect one of the new nodes to the clicked tail node (id: "${clickedNodeId}").
3. DO NOT repeat, re-use, or duplicate any of the existing node titles, labels, or definitions.
4. Return strictly valid raw JSON text. No markdown formatting, no backticks, no comments.`;

      const result = await callLlm({
        messages: [
          { role: 'system', content: 'You are a JSON-only API assistant. Never speak, never explain, never return markdown. Return strictly valid raw JSON matching the target schema.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        maxTokens: 800,
        provider: 'groq' // explicitly prioritize groq as requested
      });

      if (!result || !result.content) {
        return jsonResponse({ error: 'Failed to retrieve response from AI' }, 500, cors);
      }

      // Parse and validate JSON content
      let graphData;
      try {
        const cleanContent = result.content
          .replace(/^```json\s*/, '')
          .replace(/```$/, '')
          .trim();
        graphData = JSON.parse(cleanContent);
      } catch (err: any) {
        console.warn('[sandbox-groq] Raw AI Output:', result.content);
        return jsonResponse({ error: 'AI returned invalid JSON format', raw: result.content }, 500, cors);
      }

      return jsonResponse({ success: true, graph: graphData }, 200, cors);

    } else if (mode === 'summarize') {
      const nodes = body.nodes;
      if (!Array.isArray(nodes) || nodes.length === 0) {
        return jsonResponse({ error: 'Missing nodes array' }, 400, cors);
      }

      const prompt = `You are Chanakya's senior geopolitical threat assessment AI.

An analyst has selected a subset of intelligence nodes from the Operation Planner sandbox. Provide a professional, high-grade military intelligence summary and list of possible Courses of Action (COAs).

SELECTED INTELLIGENCE NODES:
${nodes.map(n => `- [${n.type}] ${n.label}: ${n.definition}`).join('\n')}

Provide a structured report with:
1. SECURE OPERATION SUMMARY
2. REGIONAL THREAT & POSTURING ANALYSIS
3. PROPOSED COURSES OF ACTION (COA-1, COA-2)

Structure your output using professional, high-impact tactical markdown styling. Keep it extremely objective, strategic, and high-impact.`;

      const result = await callLlm({
        messages: [
          { role: 'system', content: 'You are a senior military intelligence briefing director. Output clean, objective, structured tactical reports in markdown.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        maxTokens: 1200,
        provider: 'groq'
      });

      if (!result || !result.content) {
        return jsonResponse({ error: 'Failed to retrieve response from AI' }, 500, cors);
      }

      return jsonResponse({ success: true, report: result.content }, 200, cors);
    } else {
      return jsonResponse({ error: 'Invalid mode' }, 400, cors);
    }
  } catch (error: any) {
    console.error('[sandbox-groq] Error:', error);
    return jsonResponse({ error: 'Internal server error', details: error.message }, 500, cors);
  }
}
