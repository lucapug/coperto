import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpApi } from '../src/services/http/httpApi';
import { ServiceError } from '../src/services/api';

const BASE = 'http://api.test';

function makeApi(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  const api = new HttpApi({ baseUrl: BASE, fetchFn: fetchMock as unknown as typeof fetch });
  return { api, fetchMock };
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('HttpApi — request mapping', () => {
  it('sends the method, path and camelCase body the contract specifies', async () => {
    const { api, fetchMock } = makeApi(json(200, { party: { id: 'p1' }, group: null }));
    await api.seatParty('p1', ['t1', 't2']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/parties/p1/seat`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ tableIds: ['t1', 't2'] });
  });

  it('GETs do not send a body', async () => {
    const { api, fetchMock } = makeApi(json(200, []));
    await api.listTables();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/tables`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('dissolveGroup accepts a 204 with empty body', async () => {
    const { api } = makeApi(new Response(null, { status: 204 }));
    await expect(api.dissolveGroup('g1')).resolves.toBeUndefined();
  });
});

describe('HttpApi — error contract', () => {
  it('getShift maps 404 to null', async () => {
    const { api } = makeApi(
      json(404, { code: 'not_found', message: 'No shift has been opened yet' }),
    );
    await expect(api.getShift()).resolves.toBeNull();
  });

  it('other 404s raise ServiceError not_found with the server message', async () => {
    const { api } = makeApi(json(404, { code: 'not_found', message: 'Unknown party p1' }));
    const error = await api.markLeft('p1').catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe('not_found');
    expect(error.message).toBe('Unknown party p1');
  });

  it('maps 409 to ServiceError conflict', async () => {
    const { api } = makeApi(
      json(409, { code: 'conflict', message: "Party of 6 won't fit: 4 usable seats" }),
    );
    const error = await api.seatParty('p1', ['t1']).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe('conflict');
    expect(error.message).toContain("won't fit");
  });

  it('maps 422 to ServiceError validation', async () => {
    const { api } = makeApi(json(422, { code: 'validation', message: 'name: Field required' }));
    const error = await api.addParty({ name: 'x', size: 2, phone: '1' }).catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe('validation');
  });

  it('unexpected statuses fall back to a status-based code and message', async () => {
    const { api } = makeApi(new Response('boom', { status: 500 }));
    const error = await api.listParties().catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe('unknown');
    expect(error.message).toContain('500');
  });

  it('network failures raise a helpful ServiceError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const api = new HttpApi({ baseUrl: BASE, fetchFn: fetchMock as unknown as typeof fetch });
    const error = await api.listParties().catch((e) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error.code).toBe('network');
    expect(error.message).toContain('make backend');
  });
});
