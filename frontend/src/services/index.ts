// Single wiring point: the app imports `api` from here and nothing else.
// HttpApi talks to the FastAPI backend (openapi.yaml); set VITE_API_URL to
// override the base URL. MockApi (in-memory) stays available for tests.

import type { ApiService } from './api';
import { HttpApi } from './http/httpApi';

export const api: ApiService = new HttpApi();

export type { AddPartyInput, ApiService, SeatResult } from './api';
export { ServiceError } from './api';
export { MockApi } from './mock/mockApi';
