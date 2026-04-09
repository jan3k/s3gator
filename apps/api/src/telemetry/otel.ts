import { Logger } from "@nestjs/common";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const logger = new Logger("Telemetry");
let sdk: NodeSDK | null = null;
let started = false;

export interface TelemetryConfigInput {
  enabled: boolean;
  serviceName: string;
  otlpEndpoint?: string;
  otlpHeaders?: string;
}

export async function initTelemetry(input: TelemetryConfigInput): Promise<void> {
  if (started || !input.enabled) {
    return;
  }

  const exporter = new OTLPTraceExporter({
    url: resolveTraceUrl(input.otlpEndpoint),
    headers: parseOtlpHeaders(input.otlpHeaders)
  });

  sdk = new NodeSDK({
    traceExporter: exporter,
    serviceName: input.serviceName,
    instrumentations: [getNodeAutoInstrumentations()]
  });

  try {
    await sdk.start();
    started = true;
    logger.log(`OpenTelemetry enabled (service=${input.serviceName})`);
  } catch (error) {
    logger.error(`Failed to initialize telemetry: ${(error as Error).message}`);
    sdk = null;
    started = false;
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }

  try {
    await sdk.shutdown();
  } catch (error) {
    logger.error(`Failed to shutdown telemetry: ${(error as Error).message}`);
  } finally {
    sdk = null;
    started = false;
  }
}

function resolveTraceUrl(endpoint?: string): string | undefined {
  if (!endpoint) {
    return undefined;
  }

  const normalized = endpoint.replace(/\/+$/, "");
  if (normalized.endsWith("/v1/traces")) {
    return normalized;
  }

  return `${normalized}/v1/traces`;
}

function parseOtlpHeaders(value?: string): Record<string, string> | undefined {
  if (!value) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const [rawKey, ...rawValue] = pair.split("=");
    const key = rawKey?.trim();
    const headerValue = rawValue.join("=").trim();

    if (!key || !headerValue) {
      continue;
    }

    result[key] = headerValue;
  }

  return Object.keys(result).length ? result : undefined;
}
