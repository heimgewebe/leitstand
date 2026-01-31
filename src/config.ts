import { z } from 'zod';
import { resolve, dirname, join } from 'path';
import { readJsonFile } from './utils/fs.js';

/**
 * Schema for runtime environment variables
 */
const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.string().default('development'),
  LEITSTAND_STRICT: z.string().optional(),
  LEITSTAND_EVENTS_TOKEN: z.string().optional(),
  OBSERVATORY_STRICT: z.string().optional(),
  OBSERVATORY_STRICT_FAIL: z.string().optional(),
  OBSERVATORY_URL: z.string().default('https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json'),
  OBSERVATORY_ARTIFACT_PATH: z.string().optional(),
  INTEGRITY_URL: z.string().optional(),
  LEITSTAND_ACS_URL: z.string()
    .refine((val) => {
      // Empty string is allowed (disabled/unconfigured)
      if (val === '') return true;
      try {
        const url = new URL(val);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    }, { message: "Must be a valid HTTP/HTTPS URL or empty string" })
    .default(''),
  LEITSTAND_OPS_ALLOW_JOB_FALLBACK: z.string().optional(),
  LEITSTAND_REPOS: z.string().optional(),
});

type EnvType = z.infer<typeof EnvSchema>;

// Memoization cache
let cachedEnv: EnvType | null = null;

const parsedEnv = (): EnvType => {
    if (cachedEnv) {
        return cachedEnv;
    }

    const parsed = EnvSchema.safeParse(process.env);

    // Default values if parsing fails completely
    const defaults: EnvType = {
        PORT: 3000,
        NODE_ENV: 'development',
        OBSERVATORY_URL: 'https://github.com/heimgewebe/semantAH/releases/download/knowledge-observatory/knowledge.observatory.json',
        LEITSTAND_STRICT: undefined,
        LEITSTAND_EVENTS_TOKEN: undefined,
        OBSERVATORY_STRICT: undefined,
        OBSERVATORY_STRICT_FAIL: undefined,
        OBSERVATORY_ARTIFACT_PATH: undefined,
        INTEGRITY_URL: undefined,
        LEITSTAND_ACS_URL: '', // Default to disabled for safety
        LEITSTAND_OPS_ALLOW_JOB_FALLBACK: undefined,
        LEITSTAND_REPOS: undefined
    };

    if (!parsed.success) {
        console.warn('Invalid environment variables:', parsed.error.format());
        cachedEnv = defaults;
        return defaults;
    }

    cachedEnv = parsed.data;
    return parsed.data;
};

/**
 * Resets the environment configuration cache.
 * Call this in tests when using vi.stubEnv() to ensure changes are picked up.
 */
export const resetEnvConfig = () => {
    cachedEnv = null;
};

export const envConfig = {
    get PORT() { return parsedEnv().PORT; },
    get NODE_ENV() { return parsedEnv().NODE_ENV; },
    get OBSERVATORY_URL() { return parsedEnv().OBSERVATORY_URL; },
    get token() { return parsedEnv().LEITSTAND_EVENTS_TOKEN; },
    get OBSERVATORY_ARTIFACT_PATH() { return parsedEnv().OBSERVATORY_ARTIFACT_PATH; },
    get INTEGRITY_URL() { return parsedEnv().INTEGRITY_URL; },
    get acsUrl() { return parsedEnv().LEITSTAND_ACS_URL; },
    get allowJobFallback() { return parsedEnv().LEITSTAND_OPS_ALLOW_JOB_FALLBACK === 'true'; },

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
    },

    // Repositories known to the fleet.
    // LEITSTAND_REPOS env var overrides hardcoded defaults if present.
    get repos() {
        const envRepos = parsedEnv().LEITSTAND_REPOS;
        if (envRepos) {
            return envRepos.split(',').map(r => r.trim()).filter(r => r.length > 0);
        }
        // Fallback SoT for now
        return ['metarepo', 'wgx', 'leitstand'];
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
