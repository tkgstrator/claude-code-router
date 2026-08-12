/**
 * Chat-Completions `response_format` → Responses-API `text.format`
 * translation. The two surfaces share the same three format types but
 * differ in how json_schema is nested:
 *
 *   Chat:      {type:'json_schema', json_schema:{name,schema,strict?}}
 *   Responses: {type:'json_schema', name, schema, strict?}
 *
 * codex allow-lists top-level params and rejects raw `response_format`
 * with 400, so the reporter's strict-json production pipeline needs
 * this translation to work on /v1/chat/completions → codex.
 */

import { describe, expect, test } from 'bun:test'
import { convertResponseFormatToTextFormat } from '../../src/llms/transformers/openai/responses/request'

describe('convertResponseFormatToTextFormat', () => {
  test('text passes through as {type:text}', () => {
    expect(convertResponseFormatToTextFormat({ type: 'text' })).toEqual({ type: 'text' })
  })

  test('json_object passes through as {type:json_object}', () => {
    expect(convertResponseFormatToTextFormat({ type: 'json_object' })).toEqual({ type: 'json_object' })
  })

  test('json_schema flattens the nested json_schema wrapper onto the format', () => {
    const converted = convertResponseFormatToTextFormat({
      type: 'json_schema',
      json_schema: {
        name: 'Comments',
        strict: true,
        description: 'per-index comment array',
        schema: {
          type: 'object',
          properties: {
            comments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  text: { type: 'string' }
                },
                required: ['index', 'text']
              }
            }
          },
          required: ['comments']
        }
      }
    })
    expect(converted).toEqual({
      type: 'json_schema',
      name: 'Comments',
      strict: true,
      description: 'per-index comment array',
      schema: {
        type: 'object',
        properties: {
          comments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'integer' },
                text: { type: 'string' }
              },
              required: ['index', 'text']
            }
          }
        },
        required: ['comments']
      }
    })
  })

  test('unknown response_format type returns null (caller drops the field)', () => {
    expect(convertResponseFormatToTextFormat({ type: 'yaml_output' })).toBeNull()
  })

  test('json_schema without a json_schema block returns null', () => {
    expect(convertResponseFormatToTextFormat({ type: 'json_schema' })).toBeNull()
  })

  test('non-object input returns null', () => {
    expect(convertResponseFormatToTextFormat(null)).toBeNull()
    expect(convertResponseFormatToTextFormat('string')).toBeNull()
    expect(convertResponseFormatToTextFormat(42)).toBeNull()
  })
})
