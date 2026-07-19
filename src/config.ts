import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { readJsonFile } from './utils/fs.js';

function isTruthy(value?: string): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function isWildcardBindHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

const BindEnvSchema = z.object({
  LEITSTAND_BIND_HOST: z.string()
    .refine((value) => isIP(value) !== 0, { message: 'Must be an IPv4 or IPv6 literal' })
    .default('127.0.0.1'),
  LEITSTAND_ALLOW_WIDE_BIND: z.string().optional(),
}).superRefine((env, ctx) => {
  if (isWildcardBindHost(env.LEITSTAND_BIND_HOST) && !isTruthy(env.LEITSTAND_ALLOW_WIDE_BIND)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LEITSTAND_BIND_HOST'],
      message: 'Wildcard binding requires LEITSTAND_ALLOW_WIDE_BIND=true',
    });
  }
});

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.string().default('development'),
  LEITSTAND_STRICT: z.string().optional(),
});

type EnvType = z.infer<typeof EnvSchema>;
type BindEnvType = z.infer<typeof BindEnvSchema>;

let cachedEnv: EnvType | null = null;
let cachedBindEnv: BindEnvType | null = null;

function parsedBindEnv(): BindEnvType {
  if (cachedBindEnv) return cachedBindEnv;

  const parsed = BindEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.warn('Invalid bind environment variables:', parsed.error.format());
    cachedBindEnv = {
      LEITSTAND_BIND_HOST: '127.0.0.1',
      LEITSTAND_ALLOW_WIDE_BIND: undefined,
    };
    return cachedBindEnv;
  }

  cachedBindEnv = parsed.data;
  return parsed.data;
}

function parsedEnv(): EnvType {
  if (cachedEnv) return cachedEnv;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.warn('Invalid environment variables:', parsed.error.format());
    cachedEnv = {
      PORT: 3000,
      NODE_ENV: 'development',
      LEITSTAND_STRICT: undefined,
    };
    return cachedEnv;
  }

  cachedEnv = parsed.data;
  return parsed.data;
}

export function resetEnvConfig(): void {
  cachedEnv = null;
  cachedBindEnv = null;
}

export const envConfig = {
  get PORT() { return parsedEnv().PORT; },
  get bindHost() { return parsedBindEnv().LEITSTAND_BIND_HOST; },
  get NODE_ENV() { return parsedEnv().NODE_ENV; },
  get isStrict() {
    const env = parsedEnv();
    return env.LEITSTAND_STRICT === '1' || env.NODE_ENV === 'production';
  },
  paths: {
    artifacts: join(process.cwd(), 'artifacts'),
    fixtures: join(process.cwd(), 'src', 'fixtures'),
  },
};

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

function expandEnvVars(path: string): string {
  const unexpandedVars: string[] = [];
  const expanded = path.replace(/\$([A-Z0-9_]+)/g, (_, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      unexpandedVars.push(varName);
      return `$${varName}`;
    }
    return value;
  });

  if (unexpandedVars.length > 0) {
    throw new Error(
      `Environment variable(s) not set: ${unexpandedVars.join(', ')}. `
      + 'Please set these variables or use absolute/relative paths instead.',
    );
  }

  return expanded;
}

function resolvePath(path: string, baseDir: string): string {
  return resolve(baseDir, expandEnvVars(path));
}

export async function loadConfig(configPath: string): Promise<Config> {
  try {
    const rawConfig = await readJsonFile(configPath);
    const config = ConfigSchema.parse(rawConfig);
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
      const issues = error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
      throw new Error(`Configuration validation failed:\n${issues}`);
    }
    throw new Error(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
  }
}
