/**
 * JSON Schema → Gemini schema conversion helpers.
 *
 * Gemini's function-declaration schema is JSON-Schema-shaped but rejects
 * a number of standard fields and demands uppercase type names. The
 * helpers here normalise an incoming JSON Schema in place / return a
 * cleaned copy so it satisfies the Gemini wire contract.
 */

/** Allowed type tokens on the Gemini wire (uppercase JSON Schema types). */
const GeminiType = {
  TYPE_UNSPECIFIED: 'TYPE_UNSPECIFIED',
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  ARRAY: 'ARRAY',
  OBJECT: 'OBJECT',
  NULL: 'NULL'
} as const

const GEMINI_TYPE_VALUES: ReadonlySet<string> = new Set(Object.values(GeminiType))

/** Loose object used while walking unknown JSON-Schema-shaped payloads. */
type SchemaLike = Record<string, unknown>

const isRecord = (value: unknown): value is SchemaLike =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Recursively strip JSON Schema fields that Gemini does not accept and
 * normalise mismatched `type` / `format` / `enum` combinations.
 *
 * Mutates the input in place to match the legacy contract — callers
 * (notably the Gemini transformer) rely on side effects.
 */
export function cleanupParameters(obj: unknown, keyName?: string): void {
  if (!obj || typeof obj !== 'object') {
    return
  }

  if (Array.isArray(obj)) {
    obj.forEach((item) => {
      cleanupParameters(item)
    })
    return
  }

  const record = obj as SchemaLike

  const validFields = new Set([
    'type',
    'format',
    'title',
    'description',
    'nullable',
    'enum',
    'maxItems',
    'minItems',
    'properties',
    'required',
    'minProperties',
    'maxProperties',
    'minLength',
    'maxLength',
    'pattern',
    'example',
    'anyOf',
    'propertyOrdering',
    'default',
    'items',
    'minimum',
    'maximum'
  ])

  if (keyName !== 'properties') {
    Object.keys(record).forEach((key) => {
      if (!validFields.has(key)) {
        delete record[key]
      }
    })
  }

  if (record.enum && record.type !== 'string') {
    delete record.enum
  }

  if (record.type === 'string' && typeof record.format === 'string' && !['enum', 'date-time'].includes(record.format)) {
    delete record.format
  }

  Object.keys(record).forEach((key) => {
    cleanupParameters(record[key], key)
  })
}

/**
 * Convert an array-shaped `type` field (e.g. `['string', 'null']`) into
 * either a single uppercase `type` or an `anyOf` list, mirroring how
 * Gemini expects nullable / union types to be expressed.
 */
function flattenTypeArrayToAnyOf(typeList: Array<string>, resultingSchema: SchemaLike): void {
  if (typeList.includes('null')) {
    resultingSchema.nullable = true
  }
  const listWithoutNull = typeList.filter((type) => type !== 'null')

  if (listWithoutNull.length === 1) {
    const upperCaseType = listWithoutNull[0].toUpperCase()
    resultingSchema.type = GEMINI_TYPE_VALUES.has(upperCaseType) ? upperCaseType : GeminiType.TYPE_UNSPECIFIED
  } else {
    const anyOf: Array<{ type: string }> = []
    for (const i of listWithoutNull) {
      const upperCaseType = i.toUpperCase()
      anyOf.push({
        type: GEMINI_TYPE_VALUES.has(upperCaseType) ? upperCaseType : GeminiType.TYPE_UNSPECIFIED
      })
    }
    resultingSchema.anyOf = anyOf
  }
}

/**
 * Process a JSON schema to make it compatible with the GenAI API.
 *
 * Returns a fresh schema rather than mutating the input so the original
 * tool definition stays intact for any other transformer that wants it.
 */
function processJsonSchema(_jsonSchema: SchemaLike): SchemaLike {
  let jsonSchema = _jsonSchema
  const genAISchema: SchemaLike = {}
  const schemaFieldNames = ['items']
  const listSchemaFieldNames = ['anyOf']
  const dictSchemaFieldNames = ['properties']

  if (jsonSchema.type && jsonSchema.anyOf) {
    throw new Error('type and anyOf cannot be both populated.')
  }

  /*
  This is to handle the nullable array or object. The _jsonSchema will
  be in the format of {anyOf: [{type: 'null'}, {type: 'object'}]}. The
  logic is to check if anyOf has 2 elements and one of the element is null,
  if so, the anyOf field is unnecessary, so we need to get rid of the anyOf
  field and make the schema nullable. Then use the other element as the new
  _jsonSchema for processing. This is because the backend doesn't have a null
  type.
  */
  const incomingAnyOf = jsonSchema.anyOf
  if (incomingAnyOf != null && Array.isArray(incomingAnyOf) && incomingAnyOf.length === 2) {
    const first = incomingAnyOf[0]
    const second = incomingAnyOf[1]
    if (isRecord(first) && first.type === 'null' && isRecord(second)) {
      genAISchema.nullable = true
      jsonSchema = second
    } else if (isRecord(second) && second.type === 'null' && isRecord(first)) {
      genAISchema.nullable = true
      jsonSchema = first
    }
  }

  if (jsonSchema.type && Array.isArray(jsonSchema.type)) {
    flattenTypeArrayToAnyOf(jsonSchema.type as string[], genAISchema)
  }

  for (const [fieldName, fieldValue] of Object.entries(jsonSchema)) {
    // Skip if the fieldValue is undefined or null.
    if (fieldValue == null) {
      continue
    }

    if (fieldName === 'type') {
      if (fieldValue === 'null') {
        throw new Error('type: null can not be the only possible type for the field.')
      }
      if (Array.isArray(fieldValue)) {
        // we have already handled the type field with array of types in the
        // beginning of this function.
        continue
      }
      const upperCaseValue = String(fieldValue).toUpperCase()
      genAISchema.type = GEMINI_TYPE_VALUES.has(upperCaseValue) ? upperCaseValue : GeminiType.TYPE_UNSPECIFIED
    } else if (schemaFieldNames.includes(fieldName) && isRecord(fieldValue)) {
      genAISchema[fieldName] = processJsonSchema(fieldValue)
    } else if (listSchemaFieldNames.includes(fieldName) && Array.isArray(fieldValue)) {
      const listSchemaFieldValue: SchemaLike[] = []
      for (const item of fieldValue) {
        if (isRecord(item) && item.type === 'null') {
          genAISchema.nullable = true
          continue
        }
        if (isRecord(item)) {
          listSchemaFieldValue.push(processJsonSchema(item))
        }
      }
      genAISchema[fieldName] = listSchemaFieldValue
    } else if (dictSchemaFieldNames.includes(fieldName) && isRecord(fieldValue)) {
      const dictSchemaFieldValue: SchemaLike = {}
      for (const [key, value] of Object.entries(fieldValue)) {
        if (isRecord(value)) {
          dictSchemaFieldValue[key] = processJsonSchema(value)
        } else {
          dictSchemaFieldValue[key] = value
        }
      }
      genAISchema[fieldName] = dictSchemaFieldValue
    } else {
      // additionalProperties is not included in JSONSchema, skipping it.
      if (fieldName === 'additionalProperties') {
        continue
      }
      genAISchema[fieldName] = fieldValue
    }
  }
  return genAISchema
}

/** Shape of a single function declaration as Gemini consumes it. */
export interface GeminiFunctionDeclaration {
  name?: string
  description?: string
  parameters?: SchemaLike
  parametersJsonSchema?: SchemaLike
  response?: SchemaLike
  responseJsonSchema?: SchemaLike
}

/** Shape of a Gemini `tools[]` entry built from unified tools. */
export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[]
  googleSearch?: Record<string, never>
}

/**
 * Normalise a Gemini tool definition so its embedded function-declaration
 * schemas are compatible with the GenAI backend. Mutates the input to
 * match the legacy contract and returns the same reference.
 */
export function tTool(tool: GeminiTool): GeminiTool {
  if (tool.functionDeclarations) {
    for (const functionDeclaration of tool.functionDeclarations) {
      if (functionDeclaration.parameters) {
        if (!Object.keys(functionDeclaration.parameters).includes('$schema')) {
          functionDeclaration.parameters = processJsonSchema(functionDeclaration.parameters)
        } else {
          if (!functionDeclaration.parametersJsonSchema) {
            functionDeclaration.parametersJsonSchema = functionDeclaration.parameters
            delete functionDeclaration.parameters
          }
        }
      }
      if (functionDeclaration.response) {
        if (!Object.keys(functionDeclaration.response).includes('$schema')) {
          functionDeclaration.response = processJsonSchema(functionDeclaration.response)
        } else {
          if (!functionDeclaration.responseJsonSchema) {
            functionDeclaration.responseJsonSchema = functionDeclaration.response
            delete functionDeclaration.response
          }
        }
      }
    }
  }
  return tool
}
