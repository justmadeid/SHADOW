const appNames = [
  "platform-web",
  "platform-api",
  "connector-worker",
  "intelligence-worker",
  "indexing-worker",
];

const noCrossAppRules = appNames.map((appName) => ({
  name: `no-${appName}-to-other-apps`,
  comment: "Deployable apps communicate through stable contracts, not source imports.",
  severity: "error",
  from: {
    path: `^apps/${appName}/`,
  },
  to: {
    path: `^apps/(?!${appName}/)`,
  },
}));

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular dependencies obscure ownership and extraction boundaries.",
      severity: "error",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "not-to-unresolvable",
      comment: "Every source dependency must resolve from the declared workspace graph.",
      severity: "error",
      from: {},
      to: {
        couldNotResolve: true,
      },
    },
    {
      name: "no-packages-to-apps",
      comment: "Shared packages must not depend on deployable application internals.",
      severity: "error",
      from: {
        path: "^packages/",
      },
      to: {
        path: "^apps/",
      },
    },
    ...noCrossAppRules,
  ],
  options: {
    combinedDependencies: true,
    exclude:
      "(^|/)(\\.next|\\.turbo|coverage|dist|node_modules|playwright-report|test-results)(/|$)",
    doNotFollow: {
      path: "node_modules",
    },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "require", "node", "default"],
      exportsFields: ["exports"],
      extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    },
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
  },
};
