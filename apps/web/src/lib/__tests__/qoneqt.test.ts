import { describe, expect, it } from 'vitest';
import {
  createMockQoneqtAdapter,
  getShareAdapter,
  shareAdapterNotice,
  validateSharePayload,
  type QoneqtSharePayload,
} from '../qoneqt';

/**
 * The Qoneqt share adapter.
 *
 * The contract is not final, so the mock is written to behave like a real one: it
 * validates, it can fail, and it returns a post id and a URL. A mock that always
 * succeeds would prove nothing about the UI's error path.
 */

const payload: QoneqtSharePayload = {
  jobId: 'job_1',
  title: 'POV: binary search finally clicks',
  caption: 'Three days, one bug, zero progress.',
  hashtags: ['#dsa'],
  mp4Url: 'https://storage.example/job_1.mp4',
};

describe('validateSharePayload', () => {
  it('accepts a complete payload', () => {
    expect(validateSharePayload(payload)).toBeNull();
  });

  it('accepts a payload with hashtags but no caption', () => {
    expect(validateSharePayload({ ...payload, caption: '' })).toBeNull();
  });

  it('rejects an empty title', () => {
    expect(validateSharePayload({ ...payload, title: '   ' })).toMatch(/title/i);
  });

  it('rejects a payload with neither caption nor hashtags', () => {
    expect(validateSharePayload({ ...payload, caption: '', hashtags: [] })).toMatch(/caption|hashtag/i);
  });
});

describe('the mock adapter', () => {
  it('is not live, and says so', () => {
    const adapter = createMockQoneqtAdapter();
    expect(adapter.live).toBe(false);
    expect(shareAdapterNotice(adapter)).toMatch(/not final yet/);
    expect(shareAdapterNotice(adapter)).toMatch(/Nothing is published/);
  });

  it('returns a post id and a URL on success', async () => {
    const adapter = createMockQoneqtAdapter();
    const result = await adapter.share(payload);

    expect(result.ok).toBe(true);
    if (result.ok !== true) return;
    expect(result.postId).toContain('job_1');
    expect(result.url).toContain(result.postId);
    expect(result.adapter).toBe('qoneqt-mock');
  });

  it('fails a payload that does not validate, without pretending to post', async () => {
    const adapter = createMockQoneqtAdapter();
    const result = await adapter.share({ ...payload, title: '' });

    expect(result.ok).toBe(false);
    if (result.ok === true) return;
    expect(result.error).toMatch(/title/i);
  });

  it('can fail once, so the UI error path is testable', async () => {
    const adapter = createMockQoneqtAdapter({ failNext: true });

    const first = await adapter.share(payload);
    expect(first.ok).toBe(false);

    const second = await adapter.share(payload);
    expect(second.ok).toBe(true);
  });

  it('is what the app uses today', () => {
    expect(getShareAdapter().live).toBe(false);
    expect(getShareAdapter().name).toBe('qoneqt-mock');
  });
});
