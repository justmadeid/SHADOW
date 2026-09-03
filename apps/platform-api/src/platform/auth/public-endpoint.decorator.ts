import { SetMetadata } from "@nestjs/common";

export const PUBLIC_ENDPOINT_METADATA = Symbol("PUBLIC_ENDPOINT_METADATA");

export const PublicEndpoint = () => SetMetadata(PUBLIC_ENDPOINT_METADATA, true);
