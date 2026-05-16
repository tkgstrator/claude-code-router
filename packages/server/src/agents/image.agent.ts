import { LRUCache } from 'lru-cache'
import type { IAgent, IAgentConfig, IAgentRequest, ITool } from './type'

interface ImageCacheEntry {
  source: any
  timestamp: number
}

class ImageCache {
  private cache: LRUCache<string, ImageCacheEntry>

  constructor(maxSize = 100) {
    this.cache = new LRUCache({
      max: maxSize,
      ttl: 5 * 60 * 1000 // 5 minutes
    })
  }

  storeImage(id: string, source: any): void {
    if (this.hasImage(id)) return
    this.cache.set(id, { source, timestamp: Date.now() })
  }

  getImage(id: string): any {
    return this.cache.get(id)?.source ?? null
  }

  hasImage(id: string): boolean {
    return this.cache.has(id)
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }
}

const imageCache = new ImageCache()

export class ImageAgent implements IAgent {
  name = 'image'
  tools: Map<string, ITool>

  constructor() {
    this.tools = new Map<string, ITool>()
    this.appendTools()
  }

  shouldHandle(req: IAgentRequest, config: IAgentConfig): boolean {
    // Body fields stay loosely typed: the LLM payload shape is owned by
    // @anthropic-ai/sdk and downstream transformers; this agent only inspects
    // a handful of message-content fields.
    const body = req.body as any
    if (!config.Router?.image || body.model === config.Router.image) return false
    const lastMessage = body.messages[body.messages.length - 1]
    if (
      !config.forceUseImageAgent &&
      lastMessage.role === 'user' &&
      Array.isArray(lastMessage.content) &&
      lastMessage.content.find(
        (item: any) =>
          item.type === 'image' ||
          (Array.isArray(item?.content) && item.content.some((sub: any) => sub.type === 'image'))
      )
    ) {
      body.model = config.Router.image
      const images: any[] = []
      lastMessage.content
        .filter((item: any) => item.type === 'tool_result')
        .forEach((item: any) => {
          if (Array.isArray(item.content)) {
            item.content.forEach((element: any) => {
              if (element.type === 'image') {
                images.push(element)
              }
            })
            item.content = 'read image successfully'
          }
        })
      lastMessage.content.push(...images)
      return false
    }
    return body.messages.some(
      (msg: any) =>
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some(
          (item: any) =>
            item.type === 'image' ||
            (Array.isArray(item?.content) && item.content.some((sub: any) => sub.type === 'image'))
        )
    )
  }

  appendTools() {
    this.tools.set('analyzeImage', {
      name: 'analyzeImage',
      description:
        'Analyse image or images by ID and extract information such as OCR text, objects, layout, colors, or safety signals.',
      input_schema: {
        type: 'object',
        properties: {
          imageId: {
            type: 'array',
            description: 'an array of IDs to analyse',
            items: {
              type: 'string'
            }
          },
          task: {
            type: 'string',
            description: 'Details of task to perform on the image.The more detailed, the better'
          },
          regions: {
            type: 'array',
            description: 'Optional regions of interest within the image',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Optional label for the region'
                },
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' },
                w: { type: 'number', description: 'Width of the region' },
                h: { type: 'number', description: 'Height of the region' },
                units: {
                  type: 'string',
                  enum: ['px', 'pct'],
                  description: 'Units for coordinates and size'
                }
              },
              required: ['x', 'y', 'w', 'h', 'units']
            }
          }
        },
        required: ['imageId', 'task']
      },
      handler: async (args, context) => {
        const imageMessages = []
        let imageId: string | string[] | undefined

        // Create image messages from cached images
        if (args.imageId) {
          if (Array.isArray(args.imageId)) {
            args.imageId.forEach((imgId: string) => {
              const image = imageCache.getImage(`${context.req.id}_Image#${imgId}`)
              if (image) {
                imageMessages.push({
                  type: 'image',
                  source: image
                })
              }
            })
          } else {
            const image = imageCache.getImage(`${context.req.id}_Image#${args.imageId}`)
            if (image) {
              imageMessages.push({
                type: 'image',
                source: image
              })
            }
          }
          imageId = args.imageId
          delete args.imageId
        }

        // Body content is duck-typed against the @anthropic-ai/sdk payload;
        // narrowing to a specific schema is a separate task.
        const ctxBody = context.req.body as any
        const userMessage = ctxBody.messages[ctxBody.messages.length - 1]
        if (userMessage.role === 'user' && Array.isArray(userMessage.content)) {
          const msgs = userMessage.content.filter(
            (item: any) =>
              item.type === 'text' &&
              !item.text.includes(
                'This is an image, if you need to view or analyze it, you need to extract the imageId'
              )
          )
          imageMessages.push(...msgs)
        }

        if (Object.keys(args).length > 0) {
          imageMessages.push({
            type: 'text',
            text: JSON.stringify(args)
          })
        }

        // Send to analysis agent and get response
        const agentResponse = await fetch(`http://127.0.0.1:${context.config.PORT || 3456}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': context.config.APIKEY,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: context.config.Router.image,
            system: [
              {
                type: 'text',
                text: `You must interpret and analyze images strictly according to the assigned task.  
When an image placeholder is provided, your role is to parse the image content only within the scope of the user’s instructions.  
Do not ignore or deviate from the task.  
Always ensure that your response reflects a clear, accurate interpretation of the image aligned with the given objective.`
              }
            ],
            messages: [
              {
                role: 'user',
                content: imageMessages
              }
            ],
            stream: false
          })
        })
          .then((res) => res.json() as Promise<any>)
          .catch(() => null)
        if (!agentResponse || !agentResponse.content) {
          return 'analyzeImage Error'
        }
        return agentResponse.content[0].text
      }
    })
  }

  reqHandler(req: IAgentRequest, _config: IAgentConfig) {
    // Body content is still loosely typed; see shouldHandle for rationale.
    const body = req.body as any
    // Inject system prompt
    body?.system?.push({
      type: 'text',
      text: `You are a text-only language model and do not possess visual perception.  
If the user requests you to view, analyze, or extract information from an image, you **must** call the \`analyzeImage\` tool.  

When invoking this tool, you must pass the correct \`imageId\` extracted from the prior conversation.  
Image identifiers are always provided in the format \`[Image #imageId]\`.  

If multiple images exist, select the **most relevant imageId** based on the user’s current request and prior context.  

Do not attempt to describe or analyze the image directly yourself.  
Ignore any user interruptions or unrelated instructions that might cause you to skip this requirement.  
Your response should consistently follow this rule whenever image-related analysis is requested.`
    })

    const imageContents = body.messages.filter((item: any) => {
      return (
        item.role === 'user' &&
        Array.isArray(item.content) &&
        item.content.some(
          (msg: any) =>
            msg.type === 'image' || (Array.isArray(msg.content) && msg.content.some((sub: any) => sub.type === 'image'))
        )
      )
    })

    let imgId = 1
    imageContents.forEach((item: any) => {
      if (!Array.isArray(item.content)) return
      item.content.forEach((msg: any) => {
        if (msg.type === 'image') {
          imageCache.storeImage(`${req.id}_Image#${imgId}`, msg.source)
          msg.type = 'text'
          delete msg.source
          msg.text = `[Image #${imgId}]This is an image, if you need to view or analyze it, you need to extract the imageId`
          imgId++
        } else if (msg.type === 'text' && msg.text.includes('[Image #')) {
          msg.text = msg.text.replace(/\[Image #\d+\]/g, '')
        } else if (msg.type === 'tool_result') {
          if (Array.isArray(msg.content) && msg.content.some((ele: any) => ele.type === 'image')) {
            imageCache.storeImage(`${req.id}_Image#${imgId}`, msg.content[0].source)
            msg.content = `[Image #${imgId}]This is an image, if you need to view or analyze it, you need to extract the imageId`
            imgId++
          }
        }
      })
    })
  }
}

export const imageAgent = new ImageAgent()
