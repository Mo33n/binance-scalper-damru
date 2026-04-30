export const STARTUP_EVENTS = {
  processStart: "startup.process_start",
  configLoaded: "startup.config_loaded",
  configFeatures: "startup.config_features",
  configRollout: "startup.config_rollout",
  ready: "startup.ready",
  helpMode: "startup.help_mode",
  failed: "startup.failed",
} as const;

export type StartupEventName = (typeof STARTUP_EVENTS)[keyof typeof STARTUP_EVENTS];
