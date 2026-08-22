import { expect, test } from "vitest";
import { appSpecForImage } from "../scripts/create-image-app-spec";

const digest = `sha256:${"a".repeat(64)}`;

test("deployment preserves the app configuration while replacing the web source with a verified image", () => {
  const app = [
    {
      spec: {
        name: "ust-rankings",
        region: "sgp",
        domains: [{ domain: "ust-rankings.com", type: "PRIMARY" }],
        services: [
          {
            name: "web",
            git: { repo_clone_url: "https://example.com/repo.git" },
            dockerfile_path: "Dockerfile",
            envs: [{ key: "AUTH_SECRET", value: "encrypted" }],
            instance_count: 1,
          },
        ],
      },
    },
  ];

  expect(appSpecForImage(app, digest)).toEqual({
    name: "ust-rankings",
    region: "sgp",
    domains: [{ domain: "ust-rankings.com", type: "PRIMARY" }],
    services: [
      {
        name: "web",
        image: {
          registry_type: "GHCR",
          registry: "ust-archive",
          repository: "ust-rankings",
          digest,
        },
        envs: [{ key: "AUTH_SECRET", value: "encrypted" }],
        instance_count: 1,
      },
    ],
  });
  expect(app[0].spec.services[0]).toHaveProperty("git");
});

test("deployment rejects an unverified image reference", () => {
  expect(() => appSpecForImage({ spec: { services: [] } }, "latest")).toThrow(
    "Image digest must be a sha256 digest",
  );
});
