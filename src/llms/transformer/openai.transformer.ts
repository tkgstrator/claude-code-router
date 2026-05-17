import { Transformer } from "@/llms/types/transformer";

export class OpenAITransformer implements Transformer {
  name = "openai";
  endPoint = "/v1/chat/completions";
}
