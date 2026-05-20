import { EventEmitter } from 'node:events'

export interface RequestLogEvent {
  sessionId: string
}

class RequestLogEmitter extends EventEmitter {}

// Process-wide singleton. SSE route subscribes; llms pipeline emits.
export const requestLogEmitter = new RequestLogEmitter()
requestLogEmitter.setMaxListeners(200)
