import { describe, it, expect, beforeEach } from 'vitest';

describe('config/index', () => {
  const modPath = '../../config/index.js';

  beforeEach(() => {
    // ensure module reload picks up env changes
    Object.keys(require.cache).forEach((k) => {
      if (k.endsWith('/config/index.js') || k.endsWith('/config/index.ts')) delete require.cache[k];
    });
  });

  it('parses ENABLE_RATE_LIMIT_IN_TESTS and REQUEST_SLOW_THRESHOLD_MS', async () => {
    process.env.ENABLE_RATE_LIMIT_IN_TESTS = 'true';
    process.env.REQUEST_SLOW_THRESHOLD_MS = '100';

    const { config } = await import(modPath);
    expect(config.ENABLE_RATE_LIMIT_IN_TESTS).toBe(true);
    expect(typeof config.REQUEST_SLOW_THRESHOLD_MS).toBe('number');
    expect(config.REQUEST_SLOW_THRESHOLD_MS).toBe(100);
  });
});
