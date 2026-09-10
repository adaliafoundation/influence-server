const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = new RegExp([
  'authorization|cookie|password|secret|token|api.?key|private.?key|credential|provider|url|uri',
  'payload|body|headers|^request$|response|payment|session|card|billing|customer|^config$|^data$|^raw$'
].join('|'), 'i');

function createRedactor(secrets = []) {
  const values = [...new Set(secrets.filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => b.length - a.length);
  const redactText = (value) => {
    let text = value;
    for (const secret of values) text = text.split(secret).join(REDACTED);
    return text
      .replace(/\b(?:https?|wss?|mongodb(?:\+srv)?|rediss?):\/\/[^\s<>"']+/gi, REDACTED)
      .replace(/\b(?:Bearer|Basic)\s+[^\s,"'}]+/gi, REDACTED)
      .replace(/\b(?:sk|pk|whsec|cs)_(?:live_|test_)?[a-zA-Z0-9_]+/g, REDACTED)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED)
      .replace(/\b(password|secret|token|key|api[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, `$1=${REDACTED}`)
      .replace(/\b(payload|body|payment)\s*[:=].*/gi, `$1=${REDACTED}`);
  };
  function redact(value, seen = new WeakSet(), depth = 0) {
    if (typeof value === 'string') {
      const start = value.search(/[[{]/);
      if (start >= 0 && depth <= 10) {
        try {
          const parsed = JSON.parse(value.slice(start));
          return redactText(value.slice(0, start)) + JSON.stringify(redact(parsed, seen, depth + 1));
        } catch { /* Ordinary log messages need not contain JSON. */ }
      }
      return redactText(value);
    }
    if (typeof value === 'bigint') return value.toString();
    if (value === null || typeof value !== 'object') return value;
    if (depth > 10 || seen.has(value)) return '[Truncated]';
    seen.add(value);
    if (value instanceof Error) {
      // Upstream messages, stacks and attached HTTP objects can contain payment bodies.
      const frames = (typeof value.stack === 'string' ? value.stack : '').split('\n').slice(1)
        .filter((line) => /^\s+at /.test(line))
        .map((line) => line.match(/(?:\/app\/(?:src|bin|node_modules)\/[\w./@-]+|node:[\w/.-]+):\d+:\d+(?=\)?$)/)?.[0])
        .filter(Boolean)
        .slice(0, 8);
      return { name: redactText(value.name), message: 'Operation failed', frames };
    }
    if (Buffer.isBuffer(value)) return REDACTED;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => redact(item, seen, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      redactText(key), SENSITIVE_KEY.test(key) ? REDACTED : redact(item, seen, depth + 1)
    ]));
  }
  return redact;
}

module.exports = { createRedactor };
