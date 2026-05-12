# Time-Off Microservice

NestJS + SQLite microservice for managing employee time-off requests with HCM synchronization.

## Quick Start

```bash
pnpm install
cp .env.example .env
pnpm start:dev
```

## Mock HCM Server

```bash
pnpm start:mock-hcm
```

## Tests

```bash
pnpm test              # unit tests
pnpm test:cov          # with coverage
pnpm test:e2e          # end-to-end tests
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /time-off-requests | Submit a new request |
| GET | /time-off-requests?employeeId= | List requests for employee |
| GET | /time-off-requests/:id | Get single request |
| PATCH | /time-off-requests/:id/approve | Approve request |
| PATCH | /time-off-requests/:id/reject | Reject request |
| PATCH | /time-off-requests/:id/cancel | Cancel request |
| GET | /balances/:employeeId/:locationId | Get local balance |
| POST | /balances/:employeeId/:locationId/sync | Trigger real-time HCM sync |
| GET | /balances/discrepancies | List discrepancy events |
| POST | /hcm/batch-sync | Receive batch balance update from HCM |
