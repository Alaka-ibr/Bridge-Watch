import { describe, it, expect } from 'vitest';
import { JSONHandler } from '../formatHandlers/json.handler.js';

async function* makeAsyncIterable(records: any[]) {
  for (const r of records) {
    yield r;
  }
}

function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', (err) => reject(err));
  });
}

describe('JSONHandler', () => {
  it('wraps streamed records in an array and toggles first-record correctly', async () => {
    const handler = new JSONHandler();
    const records = [ { time: 123, symbol: 'XLM', price: 1.23 } ];
    const stream = await handler.generate(makeAsyncIterable(records), 'analytics', false);
    const out = await streamToString(stream);
    expect(out.startsWith('{"dataType":"analytics","records":[')).toBe(true);
    expect(out.includes('"symbol":"XLM"')).toBe(true);
    expect(out.endsWith(']}')).toBe(true);
  });
});
