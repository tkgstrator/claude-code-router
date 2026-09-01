/**
 * Formats defined by someone else.
 *
 * A schema belongs here when we do not get to choose its field names —
 * we can only track them. The vendor sub-barrels are the inbound chat
 * surfaces, one per wire format we accept; oauth and usage are the
 * outbound side-channels every subscription vendor exposes.
 *
 * Nothing in this layer is registered with the OpenAPI document: none
 * of it is our API.
 */

export * from './anthropic'
export * from './gemini'
export * from './oauth'
export * from './openai'
export * from './usage'
