'use strict';
/**
 * Tiny OpenAI-compatible chat-completions server for OWL's agent tests.
 *
 *   POST {base}/v1/chat/completions          normal behaviour (scripted by scenario)
 *   POST {base}/m/<mode>/v1/chat/completions  error modes: 401, 429, 429once, 500once, timeout,
 *                                             malformed, notools, stall, quota
 *   GET  {base}/v1/models                     model list (Ollama / LM Studio discovery)
 *
 * The scenario is picked from a `[[s:name]]` marker in the first user message. A scenario is a
 * function (ctx) => reply, where reply is { content?, tool_calls?: [{ name, args }] }.
 * Streams SSE (content + tool-call deltas split across chunks) when the request has stream:true.
 */
const http = require('http');

function lastTool(messages) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'tool') return String(messages[i].content || '');
  // text-only fallback mode: tool results come back as user messages
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user' && /^Tool result:/.test(String(messages[i].content))) return String(messages[i].content);
  return '';
}

/** finds the [ref] of an element whose label contains `text` in the latest snapshot */
function refOf(messages, text) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = String(messages[i].content || '');
    if (!c.includes('Interactive elements:')) continue;
    const line = c.split('\n').find((l) => /^\[\d+\]/.test(l) && l.toLowerCase().includes(text.toLowerCase()));
    if (line) return Number(line.match(/^\[(\d+)\]/)[1]);
  }
  return -1;
}

function createMockLlm({ scenarios, log = () => {} }) {
  const requests = [];
  const counters = new Map();
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const m = url.pathname.match(/^(?:\/m\/([\w-]+))?(\/.*)$/);
      const mode = (m && m[1]) || 'ok';
      const route = m ? m[2] : url.pathname;
      if (req.method === 'GET' && /\/v1\/models$/.test(route)) return json(res, 200, { data: [{ id: 'mock-model' }, { id: 'mock-small' }] });
      if (req.method === 'GET' && /\/api\/tags$/.test(route)) return json(res, 200, { models: [{ name: 'mock-model' }] });
      if (req.method !== 'POST' || !/\/v1\/chat\/completions$/.test(route)) return json(res, 404, { error: { message: 'not found: ' + route } });

      let body;
      try { body = JSON.parse(raw); } catch { return json(res, 400, { error: { message: 'bad json' } }); }
      const messages = body.messages || [];
      const firstUser = String((messages.find((x) => x.role === 'user') || {}).content || '');
      const sys = String((messages[0] && messages[0].role === 'system' && messages[0].content) || '');
      const distill = !!body.response_format || /<transcript/.test(JSON.stringify(messages.slice(-1)));
      const scen = (firstUser.match(/\[\[s:([\w-]+)\]\]/) || [])[1] || null;
      const entry = { t: Date.now(), mode, scenario: scen, distill, stream: !!body.stream, tools: (body.tools || []).map((t) => t.function.name), messages, path: url.pathname, auth: req.headers.authorization || null, body };
      requests.push(entry);
      const key = mode + '|' + (scen || '');
      const n = (counters.get(key) || 0) + 1; counters.set(key, n);

      // ----- error modes -----
      if (mode === '401') return json(res, 401, { error: { message: 'Incorrect API key provided: sk-mo***', type: 'invalid_request_error', code: 'invalid_api_key' } });
      if (mode === 'quota') return json(res, 429, { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } });
      if (mode === '429') { res.setHeader('Retry-After', '0.2'); return json(res, 429, { error: { message: 'Rate limit reached for requests' } }); }
      if (mode === '429once' && n === 1) { res.setHeader('Retry-After', '0.2'); return json(res, 429, { error: { message: 'Rate limit reached for requests' } }); }
      if (mode === '500once' && n === 1) return json(res, 502, { error: { message: 'upstream connect error' } });
      if (mode === 'timeout') return; // never answer
      if (mode === 'malformed') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"choices": [ {"message": oops this is not json'); }
      if (mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html><body>LM Studio welcome page</body></html>'); }
      if (mode === 'notools' && body.tools) return json(res, 400, { error: { message: `registry.ollama.ai/library/${body.model} does not support tools` } });
      if (mode === 'stall' && body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Partial ' } }] })}\n\n`);
        return; // then silence
      }

      // ----- normal answers -----
      let reply;
      if (distill) reply = { content: '{"memories": [], "summary": null, "observations": []}' };
      else if (scen && scenarios[scen]) {
        const steps = messages.filter((x) => x.role === 'assistant').length;
        reply = scenarios[scen]({ step: steps, messages, body, last: lastTool(messages), refOf: (t) => refOf(messages, t), mode, n, sys });
      } else reply = { content: 'Hello from the OWL mock model.' };
      if (reply && reply.delayMs) return setTimeout(() => send(res, body, reply), reply.delayMs);
      send(res, body, reply);
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

  function send(res, body, reply) {
    if (res.destroyed) return;
    if (reply.rawContent != null) reply.content = reply.rawContent;
    const calls = (reply.tool_calls || []).map((c, i) => ({ id: c.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: c.name, arguments: c.rawArgs != null ? c.rawArgs : JSON.stringify(c.args || {}) } }));
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    if (!body.stream) {
      return json(res, 200, { id: 'cmpl', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: reply.content ?? null, ...(calls.length ? { tool_calls: calls } : {}) }, finish_reason: calls.length ? 'tool_calls' : 'stop' }], usage });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const chunks = [];
    const ev = (delta, finish = null) => chunks.push({ id: 'cmpl', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] });
    ev({ role: 'assistant' });
    const text = reply.content || '';
    for (let i = 0; i < text.length; i += 7) ev({ content: text.slice(i, i + 7) });
    calls.forEach((c, idx) => {
      ev({ tool_calls: [{ index: idx, id: c.id, type: 'function', function: { name: c.function.name, arguments: '' } }] });
      const a = c.function.arguments;
      for (let i = 0; i < a.length; i += 5) ev({ tool_calls: [{ index: idx, function: { arguments: a.slice(i, i + 5) } }] });
    });
    ev({}, calls.length ? 'tool_calls' : 'stop');
    chunks.push({ id: 'cmpl', object: 'chat.completion.chunk', choices: [], usage });
    let i = 0;
    const tick = () => {
      if (res.destroyed) return;
      if (i < chunks.length) { res.write(`data: ${JSON.stringify(chunks[i++])}\n\n`); setImmediate(tick); }
      else { res.write('data: [DONE]\n\n'); res.end(); }
    };
    tick();
  }

  function json(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

  return {
    requests,
    reset() { requests.length = 0; counters.clear(); },
    listen() { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))); },
    close() { for (const s of sockets) s.destroy(); return new Promise((r) => server.close(() => r())); },
  };
}

module.exports = { createMockLlm, refOf };
