import type { MediumClient } from "../mediumClient.js";
import type { RssClient } from "../rssClient.js";
import type { ConfirmationStore } from "../confirmationStore.js";
import type { Logger } from "../logger.js";
import type { AppConfig } from "../config.js";

/** Shared dependencies injected into every tool registrar. */
export interface ToolContext {
  mediumClient: MediumClient;
  rssClient: RssClient;
  confirmationStore: ConfirmationStore;
  logger: Logger;
  config: AppConfig;
}
