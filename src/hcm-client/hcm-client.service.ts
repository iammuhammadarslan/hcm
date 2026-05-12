import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { HcmClientException, HcmUnavailableException } from '../common/exceptions/app.exception';

@Injectable()
export class HcmClientService {
  private readonly logger = new Logger(HcmClientService.name);
  private readonly client: AxiosInstance;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor() {
    this.maxRetries = parseInt(process.env.HCM_MAX_RETRIES ?? '3', 10);
    this.retryBaseMs = parseInt(process.env.HCM_RETRY_BASE_MS ?? '200', 10);

    this.client = axios.create({
      baseURL: process.env.HCM_BASE_URL ?? 'http://localhost:3001',
      timeout: parseInt(process.env.HCM_TIMEOUT_MS ?? '5000', 10),
    });
  }

  async getBalance(employeeId: string, locationId: string): Promise<number> {
    const path = `/hcm/balances/${employeeId}/${locationId}`;
    const data = await this.request<{ balance: number }>('GET', path, undefined, employeeId, locationId);
    return data.balance;
  }

  async setBalance(employeeId: string, locationId: string, balance: number): Promise<void> {
    const path = `/hcm/balances/${employeeId}/${locationId}`;
    await this.request('PUT', path, { balance }, employeeId, locationId);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    employeeId: string,
    locationId: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryBaseMs * Math.pow(2, attempt - 1);
        this.logger.debug(`[HcmClient] Retry attempt ${attempt} for ${method} ${path}, waiting ${delay}ms`);
        await this.sleep(delay);
      }

      const start = Date.now();
      try {
        const response = await this.client.request<T>({ method, url: path, data: body });
        const elapsed = Date.now() - start;
        this.logger.debug(
          `[HcmClient] ${method} ${path} → ${response.status} (attempt ${attempt + 1}, ${elapsed}ms)`,
        );
        return response.data;
      } catch (err) {
        const elapsed = Date.now() - start;
        const axiosErr = err as AxiosError;

        if (axiosErr.response) {
          const status = axiosErr.response.status;
          this.logger.debug(
            `[HcmClient] ${method} ${path} → ${status} (attempt ${attempt + 1}, ${elapsed}ms)`,
          );

          // 4xx: do not retry
          if (status >= 400 && status < 500) {
            const errBody = axiosErr.response.data as any;
            throw new HcmClientException(
              status,
              errBody?.error ?? errBody?.message ?? String(status),
              employeeId,
              locationId,
            );
          }

          // 5xx: retry
          lastError = new Error(`HCM returned ${status}`);
        } else {
          // Network timeout or connection error: retry
          this.logger.debug(
            `[HcmClient] ${method} ${path} → network error (attempt ${attempt + 1}, ${elapsed}ms): ${axiosErr.message}`,
          );
          lastError = axiosErr;
        }
      }
    }

    this.logger.error(
      `[HcmClient] FAILED ${method} ${path} after ${this.maxRetries + 1} attempts`,
    );
    throw new HcmUnavailableException(employeeId, locationId, this.maxRetries + 1);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
