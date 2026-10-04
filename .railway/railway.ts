import { defineRailway, project, service } from "railway/iac";

// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "uktransport";

export default defineRailway(() => {
  const uktransport = service("uktransport", {
    healthcheck: "/",
    healthcheckTimeout: 600,
    // dockerfilePath from CaC: "Dockerfile"
    // builder from CaC: "DOCKERFILE"
  });
  return project("uktransport-demo", {
    resources: [uktransport],
  });
});
