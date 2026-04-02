import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { config } from "../config";

export const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
export const openai = new OpenAI({ apiKey: config.openaiApiKey });
