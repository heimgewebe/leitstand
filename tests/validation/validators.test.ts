import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { validatePlexerReport, resetValidators } from '../../src/validation/validators.js';

vi.mock('fs');

describe('validatePlexerReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetValidators();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetValidators();
  });

  it('should successfully validate a correct plexer report', () => {
    // Mock fs.existsSync and fs.readFileSync for the schema
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mockSchema = {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://schemas.heimgewebe.org/contracts/plexer/delivery.report.v1.schema.json",
      "title": "Plexer Delivery Report V1",
      "type": "object",
      "required": ["counts"],
      "properties": {
        "counts": {
          "type": "object",
          "required": ["pending", "failed"],
          "properties": {
            "pending": { "type": "integer", "minimum": 0 },
            "failed": { "type": "integer", "minimum": 0 }
          }
        },
        "last_error": { "type": ["string", "null"] },
        "last_retry_at": { "type": ["string", "null"], "format": "date-time" },
        "retryable_now": { "type": "integer", "minimum": 0 },
        "next_due_at": { "type": ["string", "null"], "format": "date-time" }
      },
      "additionalProperties": false
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSchema));

    const validData = {
      counts: {
        pending: 5,
        failed: 0
      }
    };

    const result = validatePlexerReport(validData);

    expect(result.valid).toBe(true);
    expect(result.status).toBe(200);
    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.readFileSync).toHaveBeenCalled();
  });

  it('should fail validation for incorrect data', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mockSchema = {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "$id": "https://schemas.heimgewebe.org/contracts/plexer/delivery.report.v1.schema.json",
      "title": "Plexer Delivery Report V1",
      "type": "object",
      "required": ["counts"],
      "properties": {
        "counts": {
          "type": "object",
          "required": ["pending", "failed"],
          "properties": {
            "pending": { "type": "integer", "minimum": 0 },
            "failed": { "type": "integer", "minimum": 0 }
          }
        }
      },
      "additionalProperties": false
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSchema));

    const invalidData = {
      counts: {
        pending: -1 // Invalid, minimum is 0
      }
    };

    const result = validatePlexerReport(invalidData);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('/counts/pending');
  });

  it('should return 503 if schema file is missing', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const data = { counts: { pending: 0, failed: 0 } };
    const result = validatePlexerReport(data);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toBe('Schema missing');
    expect(JSON.stringify(result)).not.toContain('vendor/contracts');
  });

  it('should return 500 without details if schema compilation fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // Returning invalid JSON to cause JSON.parse to throw
    vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

    const data = { counts: { pending: 0, failed: 0 } };
    const result = validatePlexerReport(data);

    expect(result.valid).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toBe('Failed to compile validator');
    expect(JSON.stringify(result)).not.toContain('Unexpected token');
  });

  it('should reuse compiled validator on subsequent calls', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const mockSchema = {
      type: "object",
      required: ["counts"],
      properties: {
        counts: {
          type: "object",
          required: ["pending", "failed"],
          properties: {
            pending: { type: "integer", minimum: 0 },
            failed: { type: "integer", minimum: 0 }
          }
        }
      }
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockSchema));

    const data = { counts: { pending: 0, failed: 0 } };

    // First call
    validatePlexerReport(data);
    expect(fs.existsSync).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);

    // Second call
    validatePlexerReport(data);
    // Call counts shouldn't increase because the validator is cached
    expect(fs.existsSync).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync).toHaveBeenCalledTimes(1);
  });
});
