import { z } from 'zod';
import { resolve, dirname, join } from 'path';
import { readJsonFile } from './utils/fs.js';

/**
 * Schema for runtime environment variables
 */
const EnvSchema = z.object({
  PORT: z.string().transform(Number).default('3000'),
  NODE_ENV: z.string().default('development'),
  LEITSTAND_STRICT: z.string().optional(),
  LEITSTAND_EVENTS_TOKEN: z.string().optional(),
  OBSERVATORY_STRICT: z.string().optional(),
  OBSERVATORY_STRICT_FAIL: z.string().optional(),
  OBSERVATORY_URL: z.string().default('https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json'),
  OBSERVATORY_ARTIFACT_PATH: z.string().optional(),
  INTEGRITY_URL: z.string().optional(),
});

// We need to return a function or a proxy to allow live reloading of env vars during tests
// But `envConfig` is exported as a constant object.
// The issue is that the IIFE runs once at module load time.
// In tests, `server.ts` imports `config.ts`, and `vi.stubEnv` changes `process.env` AFTER `config.ts` has already initialized `envConfig`.

// To fix this without major refactoring of the usage sites, we can make `envConfig` a proxy
// or simply getters.

const parsedEnv = () => {
    const parsed = EnvSchema.safeParse(process.env);

    // Default values
    const defaults = {
        PORT: 3000,
        NODE_ENV: 'development',
        OBSERVATORY_URL: 'https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json',
        LEITSTAND_STRICT: undefined,
        LEITSTAND_EVENTS_TOKEN: undefined,
        OBSERVATORY_STRICT: undefined,
        OBSERVATORY_STRICT_FAIL: undefined,
        OBSERVATORY_ARTIFACT_PATH: undefined,
        INTEGRITY_URL: undefined
    };

    if (!parsed.success) {
        // console.warn('Invalid environment variables:', parsed.error.format());
        // Return mostly empty/defaults if parsing fails
        return defaults;
    }
    return parsed.data;
};

export const envConfig = {
    get PORT() { return parsedEnv().PORT; },
    get NODE_ENV() { return parsedEnv().NODE_ENV; },
    get OBSERVATORY_URL() { return parsedEnv().OBSERVATORY_URL; },
    get token() { return parsedEnv().LEITSTAND_EVENTS_TOKEN; },
    get OBSERVATORY_ARTIFACT_PATH() { return parsedEnv().OBSERVATORY_ARTIFACT_PATH; },
    get INTEGRITY_URL() { return parsedEnv().INTEGRITY_URL; },

    get isStrict() {
        const env = parsedEnv();
        return env.LEITSTAND_STRICT === '1' || env.NODE_ENV === 'production' || env.OBSERVATORY_STRICT === '1';
    },

    get isStrictFail() {
        return parsedEnv().OBSERVATORY_STRICT_FAIL === '1';
    },

    paths: {
      artifacts: join(process.cwd(), 'artifacts'),
      fixtures: join(process.cwd(), 'src', 'fixtures'),
    }
};


/**
 * Schema for the leitstand configuration file
 */
const ConfigSchema = z.object({
  paths: z.object({
    semantah: z.object({
      todayInsights: z.string(),
    }),
    chronik: z.object({
      dataDir: z.string(),
    }),
    wgx: z.object({
      metricsDir: z.string(),
    }),
  }),
  output: z.object({
    dir: z.string(),
  }),
  digest: z.object({
    maxEvents: z.number().int().positive().default(20),
  }).optional().default({ maxEvents: 20 }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Expands environment variables in a path string
 * @throws Error if an environment variable is not set
 */
function expandEnvVars(path: string): string {
  const unexpandedVars: string[] = [];
  
  const expanded = path.replace(/\$([A-Z0-9_]+)/g, (_, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      unexpandedVars.push(varName);
      return `$${varName}`;
    }
    return value;
  });
  
  if (unexpandedVars.length > 0) {
    throw new Error(
      `Environment variable(s) not set: ${unexpandedVars.join(', ')}. ` +
      `Please set these variables or use absolute/relative paths instead.`
    );
  }
  
  return expanded;
}

/**
 * Resolves a path relative to a base directory
 * @throws Error if path contains unexpanded environment variables
 */
function resolvePath(path: string, baseDir: string): string {
  const expanded = expandEnvVars(path);
  return resolve(baseDir, expanded);
}

/**
 * Loads and validates the configuration from a JSON file
 * 
 * @param configPath - Path to the configuration file
 * @returns Validated configuration object
 * @throws Error if config file is invalid or cannot be read
 */
export async function loadConfig(configPath: string): Promise<Config> {
  try {
    const rawConfig = await readJsonFile(configPath);
    const config = ConfigSchema.parse(rawConfig);
    
    // Resolve all paths relative to the config file directory
    const configDir = dirname(resolve(configPath));
    
    return {
      ...config,
      paths: {
        semantah: {
          todayInsights: resolvePath(config.paths.semantah.todayInsights, configDir),
        },
        chronik: {
          dataDir: resolvePath(config.paths.chronik.dataDir, configDir),
        },
        wgx: {
          metricsDir: resolvePath(config.paths.wgx.metricsDir, configDir),
        },
      },
      output: {
        dir: resolvePath(config.output.dir, configDir),
      },
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Configuration validation failed:\n${issues}`);
    }
    // readJsonFile handles syntax errors with specific message
    throw new Error(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
  }
}
