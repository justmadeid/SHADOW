import { v7 as uuidv7, validate as validateUuid } from "uuid";

export type Uuid = string;

export function newUuid(): Uuid {
  return uuidv7();
}

export function assertUuid(value: string): Uuid {
  if (!validateUuid(value)) {
    throw new Error("Invalid UUID");
  }

  return value;
}
