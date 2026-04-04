// loadtest/homepage.js
// Run: k6 run --vus 100 --duration 30s loadtest/homepage.js

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  // Homepage
  let res = http.get(`${BASE_URL}/`);
  check(res, { 'homepage 200': (r) => r.status === 200 });

  sleep(1);

  // Search
  res = http.get(`${BASE_URL}/api/v1/search?q=bike&pageSize=20`);
  check(res, { 'search 200': (r) => r.status === 200 });

  sleep(1);
}
