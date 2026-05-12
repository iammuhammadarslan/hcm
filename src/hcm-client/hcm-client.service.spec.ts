import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';
import { HcmClientService } from './hcm-client.service';
import { HcmClientException, HcmUnavailableException } from '../common/exceptions/app.exception';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HcmClientService', () => {
  let service: HcmClientService;
  let mockRequest: jest.Mock;

  beforeEach(async () => {
    process.env.HCM_MAX_RETRIES = '3';
    process.env.HCM_RETRY_BASE_MS = '1'; // fast for tests
    process.env.HCM_BASE_URL = 'http://mock-hcm';
    process.env.HCM_TIMEOUT_MS = '1000';

    mockRequest = jest.fn();
    mockedAxios.create = jest.fn().mockReturnValue({ request: mockRequest });

    const module: TestingModule = await Test.createTestingModule({
      providers: [HcmClientService],
    }).compile();

    service = module.get<HcmClientService>(HcmClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBalance', () => {
    it('returns balance on success', async () => {
      mockRequest.mockResolvedValueOnce({ status: 200, data: { balance: 10 } });
      const result = await service.getBalance('emp-1', 'loc-us');
      expect(result).toBe(10);
    });

    it('throws HcmClientException on 4xx without retry', async () => {
      const err: any = new Error('Not found');
      err.response = { status: 404, data: { error: 'NOT_FOUND' } };
      mockRequest.mockRejectedValue(err);

      await expect(service.getBalance('emp-1', 'loc-us')).rejects.toBeInstanceOf(HcmClientException);
      expect(mockRequest).toHaveBeenCalledTimes(1); // no retry
    });

    it('retries on 5xx and throws HcmUnavailableException after max retries', async () => {
      const err: any = new Error('Server error');
      err.response = { status: 503, data: {} };
      mockRequest.mockRejectedValue(err);

      await expect(service.getBalance('emp-1', 'loc-us')).rejects.toBeInstanceOf(HcmUnavailableException);
      expect(mockRequest).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });

    it('retries on network timeout and throws HcmUnavailableException', async () => {
      const err: any = new Error('timeout');
      err.code = 'ECONNABORTED';
      // no err.response = network error
      mockRequest.mockRejectedValue(err);

      await expect(service.getBalance('emp-1', 'loc-us')).rejects.toBeInstanceOf(HcmUnavailableException);
      expect(mockRequest).toHaveBeenCalledTimes(4);
    });

    it('succeeds on second attempt after one 5xx', async () => {
      const err: any = new Error('Server error');
      err.response = { status: 500, data: {} };
      mockRequest
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce({ status: 200, data: { balance: 5 } });

      const result = await service.getBalance('emp-1', 'loc-us');
      expect(result).toBe(5);
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('setBalance', () => {
    it('calls PUT with correct body', async () => {
      mockRequest.mockResolvedValueOnce({ status: 200, data: {} });
      await service.setBalance('emp-1', 'loc-us', 8);
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'PUT', data: { balance: 8 } }),
      );
    });

    it('throws HcmClientException on 422 without retry', async () => {
      const err: any = new Error('Insufficient');
      err.response = { status: 422, data: { error: 'INSUFFICIENT_BALANCE', available: 3 } };
      mockRequest.mockRejectedValue(err);

      await expect(service.setBalance('emp-1', 'loc-us', 10)).rejects.toBeInstanceOf(HcmClientException);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });
});
