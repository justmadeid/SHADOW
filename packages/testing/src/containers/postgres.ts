import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

export type StartedPostgresTestContainer = {
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
};

export async function startPostgresTestContainer(): Promise<StartedPostgresTestContainer> {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("intelligence_test")
    .withUsername("intelligence_test")
    .withPassword("intelligence_test_password")
    .start();

  return {
    container,
    databaseUrl: container.getConnectionUri(),
  };
}
