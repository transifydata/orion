import { describe, it, vi, expect, beforeEach } from 'vitest';
import { handler } from './lambda';
import type { LambdaEvent, LambdaResponse } from './types';
import type { Context, Callback } from 'aws-lambda';

// Create the spy before mocking the module
const mockPutObjectPromise = vi.fn().mockResolvedValue({});

// Mock AWS S3
vi.mock('aws-sdk', () => ({
  default: {
    S3: class {
      putObject() {
        return {
          promise: mockPutObjectPromise
        };
      }
    }
  }
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    get: vi.fn()
  }
}));

describe('Lambda Handler', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
    
  });

  it('should process agency data and save to S3', async () => {
    const sampleEvent: LambdaEvent = { };
    
    // Setup axios mock for this test
    const axios = await import('axios');
    (axios.default.get as any).mockImplementation(() =>
      Promise.resolve({
        data: Buffer.from('mock protobuf data'),
        status: 200
      })
    );

    const result = await handler(
      sampleEvent,
      {} as Context,
      (() => {}) as Callback
    ) as LambdaResponse;

    // Verify the response structure
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      message: 'Successfully saved vehicle data to S3'
    });

    // Verify axios was called correctly
    expect(axios.default.get).toHaveBeenCalledTimes(5);
    
    // Verify S3 putObject was called 5 times
    expect(mockPutObjectPromise).toHaveBeenCalledTimes(5);
  });
});