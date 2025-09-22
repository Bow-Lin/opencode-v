// test/util/rerank.test.ts
import { describe, it, expect } from 'bun:test';
import { rerankSymbols } from '../../src/util/rerank';

describe('rerankSymbols', () => {
  it('should rerank symbols based on name match', async () => {
    const candidates = [
      {
        symbol_fqn: 'myproject.utils.helpers.format_string',
        vector_score: 0.8,
        details: {
          name: 'format_string',
          module_fqn: 'myproject.utils.helpers',
          type: 'function',
          visibility: 'public',
          docstring: 'Formats a string for database storage.',
          docstring_summary: 'Formats a string for database storage.',
          signature_parameters: '["input_string", "encoding"]',
          signature_returnType: 'str',
          signature_decorators: '[]'
        }
      },
      {
        symbol_fqn: 'myproject.models.user.User',
        vector_score: 0.75,
        details: {
          name: 'User',
          module_fqn: 'myproject.models.user',
          type: 'class',
          visibility: 'public',
          docstring: 'Represents a user in the system.',
          docstring_summary: 'Represents a user in the system.',
          signature_parameters: '[]',
          signature_returnType: 'None',
          signature_decorators: '[]'
        }
      }
    ];

    const query = 'format string function';
    const result = await rerankSymbols(candidates, query);

    // The function with 'format_string' in its name and relevant docstring should be ranked higher
    // due to the high name_score and doc_score, even if the initial vector_score was slightly lower
    // than the class match.
    expect(result[0].symbol_fqn).toBe('myproject.utils.helpers.format_string');
    // Check that final score is calculated and is a number between 0 and 1
    expect(result[0].final_score).toBeGreaterThanOrEqual(0);
    expect(result[0].final_score).toBeLessThanOrEqual(1);
    // Check that individual scores are calculated
    expect(result[0].name_score).toBeGreaterThan(0);
    expect(result[0].doc_score).toBeGreaterThan(0);
  });

  it('should handle candidates without details', async () => {
    const candidates = [
      {
        symbol_fqn: 'myproject.utils.helpers.format_string',
        vector_score: 0.8
        // No details
      }
    ];

    const query = 'format string';
    const result = await rerankSymbols(candidates, query);

    // Should fall back to vector score
    expect(result[0].symbol_fqn).toBe('myproject.utils.helpers.format_string');
    expect(result[0].final_score).toBe(0.8);
    expect(result[0].name_score).toBe(0);
    expect(result[0].doc_score).toBe(0);
  });

  it('should sort candidates by final score', async () => {
    const candidates = [
      {
        symbol_fqn: 'symbol_a',
        vector_score: 0.5,
        details: {
          name: 'SymbolA',
          module_fqn: 'module_a',
          type: 'function',
          visibility: 'public',
          docstring: 'This is a great function for doing things.',
          docstring_summary: 'This is a great function for doing things.',
          signature_parameters: '["param1", "param2"]',
          signature_returnType: 'int',
          signature_decorators: '[]'
        }
      },
      {
        symbol_fqn: 'symbol_b',
        vector_score: 0.9,
        details: {
          name: 'SymbolB',
          module_fqn: 'module_b',
          type: 'class',
          visibility: 'public',
          docstring: 'A simple class.',
          docstring_summary: 'A simple class.',
          signature_parameters: '[]',
          signature_returnType: 'None',
          signature_decorators: '[]'
        }
      },
      {
        symbol_fqn: 'symbol_c',
        vector_score: 0.6,
        details: {
          name: 'process_data',
          module_fqn: 'module_c',
          type: 'function',
          visibility: 'public',
          docstring: 'Processes data efficiently.',
          docstring_summary: 'Processes data efficiently.',
          signature_parameters: '["data", "config"]',
          signature_returnType: 'ProcessedData',
          signature_decorators: '[]'
        }
      }
    ];

    const query = 'process data function';
    const result = await rerankSymbols(candidates, query);

    // Expect the function named 'process_data' with a relevant docstring to be ranked highest
    // after reranking, even if its initial vector score was not the highest.
    expect(result[0].symbol_fqn).toBe('symbol_c'); // process_data
    // Ensure the list is sorted by final_score descending
    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i].final_score).toBeGreaterThanOrEqual(result[i + 1].final_score);
    }
  });
});