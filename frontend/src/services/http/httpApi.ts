// Real-backend implementation of ApiService over the REST contract in
// openapi.yaml (FastAPI backend in backend/).

import type { Party, Shift, Table, TableGroup } from '../../types';
import {
  ServiceError,
  type ApiService,
  type AddPartyInput,
  type SeatResult,
} from '../api';

interface ApiErrorBody {
  code?: string;
  message?: string;
}

export interface HttpApiOptions {
  baseUrl?: string;
  /** injectable for tests */
  fetchFn?: typeof fetch;
}

function codeForStatus(status: number): ServiceError['code'] {
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'validation';
  return 'unknown';
}

export class HttpApi implements ApiService {
  private readonly baseUrl: string;
  private readonly fetchFn?: typeof fetch;

  constructor(options: HttpApiOptions = {}) {
    const fromEnv = import.meta.env?.VITE_API_URL;
    this.baseUrl = (options.baseUrl ?? fromEnv ?? 'http://localhost:3000').replace(
      /\/+$/,
      '',
    );
    this.fetchFn = options.fetchFn;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts: { nullOnNotFound?: boolean } = {},
  ): Promise<T> {
    let response: Response;
    try {
      const doFetch = this.fetchFn ?? fetch;
      response = await doFetch(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ServiceError('Backend unreachable — start it with `make backend`', 'network');
    }

    if (response.status === 204) {
      return undefined as T;
    }
    if (response.ok) {
      return (await response.json()) as T;
    }

    let errorBody: ApiErrorBody = {};
    try {
      errorBody = (await response.json()) as ApiErrorBody;
    } catch {
      // non-JSON error body — fall through to the status-based mapping
    }
    if (response.status === 404 && opts.nullOnNotFound) {
      return null as T;
    }
    throw new ServiceError(
      errorBody.message ?? `Request failed with status ${response.status}`,
      (errorBody.code as ServiceError['code']) ?? codeForStatus(response.status),
    );
  }

  // ---- shift lifecycle

  getShift(): Promise<Shift | null> {
    return this.request<Shift | null>('GET', '/shift', undefined, {
      nullOnNotFound: true,
    });
  }

  openShift(): Promise<Shift> {
    return this.request<Shift>('POST', '/shift');
  }

  closeShift(): Promise<Shift> {
    return this.request<Shift>('POST', '/shift/close');
  }

  // ---- tables and groups

  listTables(): Promise<Table[]> {
    return this.request<Table[]>('GET', '/tables');
  }

  listGroups(): Promise<TableGroup[]> {
    return this.request<TableGroup[]>('GET', '/groups');
  }

  combineTables(tableIds: string[]): Promise<TableGroup> {
    return this.request<TableGroup>('POST', '/groups', { tableIds });
  }

  dissolveGroup(groupId: string): Promise<void> {
    return this.request<void>('DELETE', `/groups/${groupId}`);
  }

  // ---- parties

  listParties(): Promise<Party[]> {
    return this.request<Party[]>('GET', '/parties');
  }

  addParty(input: AddPartyInput): Promise<Party> {
    return this.request<Party>('POST', '/parties', input);
  }

  seatParty(partyId: string, tableIds: string[]): Promise<SeatResult> {
    return this.request<SeatResult>('POST', `/parties/${partyId}/seat`, { tableIds });
  }

  markArrived(partyId: string): Promise<Party> {
    return this.request<Party>('POST', `/parties/${partyId}/arrived`);
  }

  markLeft(partyId: string): Promise<Party> {
    return this.request<Party>('POST', `/parties/${partyId}/left`);
  }

  requeueParty(partyId: string): Promise<Party> {
    return this.request<Party>('POST', `/parties/${partyId}/requeue`);
  }

  // ---- maintenance

  sweep(): Promise<Party[]> {
    return this.request<Party[]>('POST', '/sweep');
  }
}
