import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";

export type StartedMinioTestContainer = {
  container: StartedTestContainer;
  endpoint: string;
  accessKey: string;
  secretKey: string;
};

export async function startMinioTestContainer(): Promise<StartedMinioTestContainer> {
  const accessKey = "test-minio";
  const secretKey = "test-minio-secret-change-me";

  const container = await new GenericContainer("minio/minio:RELEASE.2025-07-23T15-54-02Z")
    .withEnvironment({
      MINIO_ROOT_USER: accessKey,
      MINIO_ROOT_PASSWORD: secretKey,
    })
    .withCommand(["server", "/data"])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp("/minio/health/live", 9000))
    .start();

  return {
    container,
    endpoint: `http://${container.getHost()}:${container.getMappedPort(9000)}`,
    accessKey,
    secretKey,
  };
}
