// Force the BASIC (unlicensed) plan for the API verification scripts so their
// plan-limit assertions stay deterministic regardless of the deployment's
// LICENSE_KEY. Imported first so env is primed before env.ts is evaluated.
process.env.LICENSE_KEY = "";
process.env.MEGACODE_LICENSE_PUBLIC_KEY = "";

export {};
