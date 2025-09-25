import { QuoteApi, createQuoteWrapper, RetryableError, NonRetryableError } from '../quote-api';
import { jest } from '@jest/globals';

// Mock fetch globally
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe('QuoteApi', () => {
  let quoteApi: QuoteApi;
  const mockBaseUrl = 'https://test-api.example.com';

  beforeEach(() => {
    quoteApi = new QuoteApi(mockBaseUrl);
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Token Format Validation', () => {
    it('should convert valid SDK token format to API format', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Success',
          error: false,
          data: {
            currentSqrtPrice: '1000000',
            newSqrtPrice: '1100000',
            fee: 3000,
            amountIn: '100',
            amountOut: '95'
          }
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(mockResponse as Response);

      const result = await quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('tokenIn=GALA%24Unit%24none%24none&tokenOut=GUSDC%24Unit%24none%24none'),
        expect.any(Object)
      );
      expect(result.outTokenAmount).toBe('95');
    });

    it('should reject invalid token format - empty string', async () => {
      await expect(
        quoteApi.quoteExactInput('', 'GUSDC|Unit|none|none', 100)
      ).rejects.toThrow('Invalid token format: token must be a non-empty string');
    });

    it('should reject invalid token format - non-string input', async () => {
      await expect(
        quoteApi.quoteExactInput(null as any, 'GUSDC|Unit|none|none', 100)
      ).rejects.toThrow('Invalid token format: token must be a non-empty string, got: object');
    });

    it('should reject invalid token format - wrong number of parts', async () => {
      await expect(
        quoteApi.quoteExactInput('GALA|Unit|none', 'GUSDC|Unit|none|none', 100)
      ).rejects.toThrow('Invalid token format: expected 4 parts (Collection|Category|Type|AdditionalKey), got 3 parts');
    });

    it('should reject invalid token format - empty parts', async () => {
      await expect(
        quoteApi.quoteExactInput('GALA||none|none', 'GUSDC|Unit|none|none', 100)
      ).rejects.toThrow('Invalid token format: empty parts not allowed');
    });
  });

  describe('Price Impact Calculation', () => {
    it('should calculate price impact correctly', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Success',
          error: false,
          data: {
            currentSqrtPrice: '1000000',
            newSqrtPrice: '1050000', // 5% price change
            fee: 3000,
            amountIn: '100',
            amountOut: '95'
          }
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(mockResponse as Response);

      const result = await quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      expect(result.priceImpact).toBeCloseTo(5, 6); // 5% price impact (allow floating point precision)
    });

    it('should handle missing sqrt prices gracefully', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Success',
          error: false,
          data: {
            currentSqrtPrice: '',
            newSqrtPrice: '',
            fee: 3000,
            amountIn: '100',
            amountOut: '95'
          }
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(mockResponse as Response);

      const result = await quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      expect(result.priceImpact).toBe(0);
    });

    it('should handle invalid sqrt price data', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Success',
          error: false,
          data: {
            currentSqrtPrice: 'invalid',
            newSqrtPrice: '1050000',
            fee: 3000,
            amountIn: '100',
            amountOut: '95'
          }
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(mockResponse as Response);

      const result = await quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      expect(result.priceImpact).toBe(0);
    });
  });

  describe('Error Handling and Retries', () => {
    it('should retry on rate limit errors (429)', async () => {
      const rateLimitResponse = {
        ok: false,
        status: 429,
        json: async () => ({})
      };

      const successResponse = {
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Success',
          error: false,
          data: {
            currentSqrtPrice: '1000000',
            newSqrtPrice: '1050000',
            fee: 3000,
            amountIn: '100',
            amountOut: '95'
          }
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce(rateLimitResponse as Response)
        .mockResolvedValueOnce(successResponse as Response);

      const quotePromise = quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      // Advance timers to skip retry delays
      await jest.runAllTimersAsync();

      const result = await quotePromise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.outTokenAmount).toBe('95');
    });

    it('should retry on server errors (500+)', async () => {
      const serverErrorResponse = {
        ok: false,
        status: 503,
        json: async () => ({})
      };

      const successResponse = {
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Success',
          error: false,
          data: {
            currentSqrtPrice: '1000000',
            newSqrtPrice: '1050000',
            fee: 3000,
            amountIn: '100',
            amountOut: '95'
          }
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce(serverErrorResponse as Response)
        .mockResolvedValueOnce(successResponse as Response);

      const quotePromise = quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      // Advance timers to skip retry delays
      await jest.runAllTimersAsync();

      const result = await quotePromise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.outTokenAmount).toBe('95');
    });

    it('should not retry on client errors (400-499 except 429)', async () => {
      const clientErrorResponse = {
        ok: false,
        status: 404,
        json: async () => ({})
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(clientErrorResponse as Response);

      await expect(
        quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100)
      ).rejects.toThrow('Endpoint not found');

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should exhaust all retries and throw final error', async () => {
      const serverErrorResponse = {
        ok: false,
        status: 500,
        json: async () => ({})
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(serverErrorResponse as Response);

      const quotePromise = quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      // Advance timers to skip retry delays
      await jest.runAllTimersAsync();

      await expect(quotePromise).rejects.toThrow('Server error');

      // Should call initial + 3 retries = 4 total calls
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    it('should handle network errors with retries', async () => {
      const networkError = new Error('network error');
      const successResponse = {
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Success',
          error: false,
          data: {
            currentSqrtPrice: '1000000',
            newSqrtPrice: '1050000',
            fee: 3000,
            amountIn: '100',
            amountOut: '95'
          }
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce(successResponse as Response);

      const quotePromise = quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      // Advance timers to skip retry delays
      await jest.runAllTimersAsync();

      const result = await quotePromise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.outTokenAmount).toBe('95');
    });

    it('should handle API error responses', async () => {
      const apiErrorResponse = {
        ok: true,
        json: async () => ({
          status: 400,
          message: 'Invalid token pair',
          error: true,
          data: null
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(apiErrorResponse as Response);

      await expect(
        quoteApi.quoteExactInput('INVALID|Token|none|none', 'GUSDC|Unit|none|none', 100)
      ).rejects.toThrow('Quote API error: Invalid token pair');

      expect(global.fetch).toHaveBeenCalledTimes(1); // No retries for API errors
    });
  });

  describe('Timeout Handling', () => {
    it('should handle timeout errors with retries', async () => {
      const timeoutError = new Error('Request timeout after 5000ms');
      timeoutError.name = 'TimeoutError';

      const successResponse = {
        ok: true,
        json: async () => ({
          status: 200,
          message: 'Success',
          error: false,
          data: {
            currentSqrtPrice: '1000000',
            newSqrtPrice: '1050000',
            fee: 3000,
            amountIn: '100',
            amountOut: '95'
          }
        })
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(successResponse as Response);

      const quotePromise = quoteApi.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

      // Advance timers to skip retry delays
      await jest.runAllTimersAsync();

      const result = await quotePromise;

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.outTokenAmount).toBe('95');
    });

    it('should configure custom timeout', () => {
      const customTimeout = 10000;
      quoteApi.setTimeout(customTimeout);

      // Access private property for testing
      expect((quoteApi as any).timeout).toBe(customTimeout);
    });
  });

  describe('Exponential Backoff', () => {
    it('should use longer delays for rate limit errors', () => {
      const delay1 = (quoteApi as any).calculateRetryDelay(0, 'RATE_LIMIT');
      const delay2 = (quoteApi as any).calculateRetryDelay(0, 'SERVER_ERROR');

      expect(delay1).toBeGreaterThan(delay2);
    });

    it('should increase delay exponentially with attempt number', () => {
      const delay0 = (quoteApi as any).calculateRetryDelay(0, 'SERVER_ERROR');
      const delay1 = (quoteApi as any).calculateRetryDelay(1, 'SERVER_ERROR');
      const delay2 = (quoteApi as any).calculateRetryDelay(2, 'SERVER_ERROR');

      expect(delay1).toBeGreaterThan(delay0);
      expect(delay2).toBeGreaterThan(delay1);
    });

    it('should include jitter in retry delays', () => {
      const delays = [];
      for (let i = 0; i < 10; i++) {
        delays.push((quoteApi as any).calculateRetryDelay(1, 'SERVER_ERROR'));
      }

      // With jitter, delays should vary
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });

  describe('AbortSignal Fallback', () => {
    it('should use AbortSignal.timeout when available', () => {
      const mockTimeout = jest.fn().mockReturnValue({ signal: 'mock-signal' });
      (global as any).AbortSignal = { timeout: mockTimeout };

      const signal = (quoteApi as any).createTimeoutSignal(5000);

      expect(mockTimeout).toHaveBeenCalledWith(5000);
      expect(signal).toBe(mockTimeout.mock.results[0].value);
    });

    it('should fallback to AbortController when AbortSignal.timeout unavailable', () => {
      delete (global as any).AbortSignal;

      const signal = (quoteApi as any).createTimeoutSignal(5000);

      expect(signal).toBeDefined();
      expect(typeof signal.addEventListener).toBe('function');
    });
  });
});

describe('createQuoteWrapper', () => {
  it('should create wrapper with quoteExactInput method', () => {
    const wrapper = createQuoteWrapper('https://test-api.example.com');

    expect(wrapper).toHaveProperty('quoteExactInput');
    expect(typeof wrapper.quoteExactInput).toBe('function');
  });

  it('should pass through calls to underlying QuoteApi', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        status: 200,
        message: 'Success',
        error: false,
        data: {
          currentSqrtPrice: '1000000',
          newSqrtPrice: '1050000',
          fee: 3000,
          amountIn: '100',
          amountOut: '95'
        }
      })
    };

    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(mockResponse as Response);

    const wrapper = createQuoteWrapper('https://test-api.example.com');
    const result = await wrapper.quoteExactInput('GALA|Unit|none|none', 'GUSDC|Unit|none|none', 100);

    expect(result.outTokenAmount).toBe('95');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('tokenIn=GALA%24Unit%24none%24none'),
      expect.any(Object)
    );
  });
});