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

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const VALID_GEMINI_FIELDS: ReadonlySet<string> = new Set([
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

  if (!isRecord(obj)) {
    return
  }
  const record: SchemaLike = obj

  if (keyName !== 'properties') {
    Object.keys(record).forEach((key) => {
      if (!VALID_GEMINI_FIELDS.has(key)) {
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
 * Collapse the `{ anyOf: [{ type: 'null' }, X] }` JSON-Schema pattern
 * (used for nullable values) into `{ nullable: true, ...X }`. Returns
 * the schema to use for further processing — either the non-null branch
 * or the input untouched.
 */
function unwrapNullableAnyOf(jsonSchema: SchemaLike, genAISchema: SchemaLike): SchemaLike {
  const incomingAnyOf = jsonSchema.anyOf
  if (!Array.isArray(incomingAnyOf) || incomingAnyOf.length !== 2) {
    return jsonSchema
  }
  const [first, second] = incomingAnyOf
  if (isRecord(first) && first.type === 'null' && isRecord(second)) {
    genAISchema.nullable = true
    return second
  }
  if (isRecord(second) && second.type === 'null' && isRecord(first)) {
    genAISchema.nullable = true
    return first
  }
  return jsonSchema
}

const SCHEMA_FIELD_NAMES: ReadonlySet<string> = new Set(['items'])
const LIST_SCHEMA_FIELD_NAMES: ReadonlySet<string> = new Set(['anyOf'])
const DICT_SCHEMA_FIELD_NAMES: ReadonlySet<string> = new Set(['properties'])

/**
 * Process the `type` field of a JSON schema and write the Gemini-shaped
 * equivalent onto `genAISchema`.
 */
function applyTypeField(value: unknown, genAISchema: SchemaLike): void {
  if (value === 'null') {
    throw new Error('type: null can not be the only possible type for the field.')
  }
  if (Array.isArray(value)) {
    // Array-typed fields are handled separately before this dispatch.
    return
  }
  const upperCaseValue = String(value).toUpperCase()
  genAISchema.type = GEMINI_TYPE_VALUES.has(upperCaseValue) ? upperCaseValue : GeminiType.TYPE_UNSPECIFIED
}

/**
 * Process a JSON-Schema `anyOf`-style list field, recursively converting
 * each element and lifting `{ type: 'null' }` entries into a top-level
 * `nullable: true` flag.
 */
function processListSchemaField(fieldValue: unknown[], genAISchema: SchemaLike): SchemaLike[] {
  const out: SchemaLike[] = []
  for (const item of fieldValue) {
    if (isRecord(item) && item.type === 'null') {
      genAISchema.nullable = true
      continue
    }
    if (isRecord(item)) {
      out.push(processJsonSchema(item))
    }
  }
  return out
}

/**
 * Process a JSON-Schema `properties`-style map field, recursively
 * converting each value to the Gemini shape.
 */
function processDictSchemaField(fieldValue: SchemaLike): SchemaLike {
  const out: SchemaLike = {}
  for (const [key, value] of Object.entries(fieldValue)) {
    out[key] = isRecord(value) ? processJsonSchema(value) : value
  }
  return out
}

/**
 * Convert one entry of a JSON schema's top-level object into the
 * matching Gemini-shaped field on `genAISchema`. Returns whether the
 * entry was consumed (callers can fall through to a default copy).
 */
function processSchemaEntry(fieldName: string, fieldValue: unknown, genAISchema: SchemaLike): void {
  if (fieldName === 'type') {
    applyTypeField(fieldValue, genAISchema)
    return
  }
  if (SCHEMA_FIELD_NAMES.has(fieldName) && isRecord(fieldValue)) {
    genAISchema[fieldName] = processJsonSchema(fieldValue)
    return
  }
  if (LIST_SCHEMA_FIELD_NAMES.has(fieldName) && Array.isArray(fieldValue)) {
    genAISchema[fieldName] = processListSchemaField(fieldValue, genAISchema)
    return
  }
  if (DICT_SCHEMA_FIELD_NAMES.has(fieldName) && isRecord(fieldValue)) {
    genAISchema[fieldName] = processDictSchemaField(fieldValue)
    return
  }
  if (fieldName === 'additionalProperties') {
    // additionalProperties is not included in JSONSchema, skipping it.
    return
  }
  genAISchema[fieldName] = fieldValue
}

/**
 * Process a JSON schema to make it compatible with the GenAI API.
 *
 * Returns a fresh schema rather than mutating the input so the original
 * tool definition stays intact for any other transformer that wants it.
 */
function processJsonSchema(_jsonSchema: SchemaLike): SchemaLike {
  const genAISchema: SchemaLike = {}

  if (_jsonSchema.type && _jsonSchema.anyOf) {
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
  const jsonSchema = unwrapNullableAnyOf(_jsonSchema, genAISchema)

  if (jsonSchema.type && isStringArray(jsonSchema.type)) {
    flattenTypeArrayToAnyOf(jsonSchema.type, genAISchema)
  }

  for (const [fieldName, fieldValue] of Object.entries(jsonSchema)) {
    // Skip if the fieldValue is undefined or null.
    if (fieldValue == null) {
      continue
    }
    // The array-of-strings `type` case was already handled by
    // `flattenTypeArrayToAnyOf`; skip the `type` entry in that scenario
    // so we don't overwrite the result.
    if (fieldName === 'type' && Array.isArray(fieldValue)) {
      continue
    }
    processSchemaEntry(fieldName, fieldValue, genAISchema)
  }
  return genAISchema
}

/** Shape of a single function declaration as Gemini consumes it. */
export type GeminiFunctionDeclaration = {
  name?: string
  description?: string
  parameters?: SchemaLike
  parametersJsonSchema?: SchemaLike
  response?: SchemaLike
  responseJsonSchema?: SchemaLike
}

/** Shape of a Gemini `tools[]` entry built from unified tools. */
export type GeminiTool = {
  functionDeclarations?: GeminiFunctionDeclaration[]
  googleSearch?: Record<string, never>
}

/**
 * Decide how a single declaration field (`parameters` / `response`)
 * should be rewritten: when the underlying JSON schema is a raw JSON
 * Schema (no `$schema` marker) we process it; when it has `$schema`
 * we lift it to the `<field>JsonSchema` slot Gemini expects.
 */
function applyDeclarationField(
  declaration: GeminiFunctionDeclaration,
  field: 'parameters' | 'response',
  jsonSchemaField: 'parametersJsonSchema' | 'responseJsonSchema'
): void {
  const value = declaration[field]
  if (!value) {
    return
  }
  if (!Object.keys(value).includes('$schema')) {
    declaration[field] = processJsonSchema(value)
    return
  }
  if (!declaration[jsonSchemaField]) {
    declaration[jsonSchemaField] = value
    delete declaration[field]
  }
}

/**
 * Normalise a Gemini tool definition so its embedded function-declaration
 * schemas are compatible with the GenAI backend. Mutates the input to
 * match the legacy contract and returns the same reference.
 */
export function tTool(tool: GeminiTool): GeminiTool {
  if (tool.functionDeclarations) {
    for (const functionDeclaration of tool.functionDeclarations) {
      applyDeclarationField(functionDeclaration, 'parameters', 'parametersJsonSchema')
      applyDeclarationField(functionDeclaration, 'response', 'responseJsonSchema')
    }
  }
  return tool
}
