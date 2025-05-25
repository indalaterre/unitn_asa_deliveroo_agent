// esbuild.config.ts
import { build } from "esbuild";

build({
    entryPoints: [
        "src/main-bdi.ts",
        "src/utils/matrix.ts",
        "src/utils/clustering-worker.ts"
    ],
    outdir: 'dist',
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    alias: {
        "@": "./src",
        "@domain": "./src/domain",
        "@utils": "./src/utils"
    },
    logLevel: "info"
}).catch(() => process.exit(1));
