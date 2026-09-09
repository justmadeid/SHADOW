import { PostgreSqlContainer } from "@testcontainers/postgresql";

export async function startPostgresTestContainer() {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("intelligence_test")
    .withUsername("intelligence")
    .withPassword("intelligence")
    .start();

  return {
    container,
    databaseUrl: container.getConnectionUri(),
  };
}

export {
  startRedisTestContainer,
  type StartedRedisTestContainer,
} from "./containers/redis.js";
