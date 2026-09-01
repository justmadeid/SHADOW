export type { ResourceRef } from "@intelligence/contracts";

export type ApiClientOptions = {
  baseUrl: string;
};

export function createApiClient(options: ApiClientOptions) {
  return {
    baseUrl: options.baseUrl.replace(/\/$/, ""),
  };
}
