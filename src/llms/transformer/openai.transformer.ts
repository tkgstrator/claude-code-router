import { Transformer } from "@/llms/types/transformer";

export class OpenAITransformer implements Transformer {
  name = "OpenAI";
  endPoint = "/v1/chat/completions";
}
