// Single wiring point: the app imports `api` from here and nothing else.
// Swap MockApi for an HTTP client when the real backend lands.

import type { ApiService } from './api';
import { MockApi } from './mock/mockApi';

export const api: ApiService = new MockApi();

export type { AddPartyInput, ApiService, SeatResult } from './api';
export { ServiceError } from './api';
