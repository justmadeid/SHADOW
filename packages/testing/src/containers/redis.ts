import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

export type StartedRedisTestContainer = {
  container: StartedTestContainer;
  redisUrl: string;
};

export async function startRedisTestContainer(): Promise<StartedRedisTestContainer> {
  const container = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .withCommand([
      "redis-server",
      "--appendonly",
      "no",
      "--maxmemory-policy",
      "noeviction",
    ])
    .withWaitStrategy(Wait.forLogMessage("Ready to accept connections"))
    .start();

  return {
    container,
    redisUrl: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
  };
}
