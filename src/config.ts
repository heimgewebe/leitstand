import { z } from 'zod';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';

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
    timezone: z.enum(['UTC', 'local']).default('UTC'),
  }).optional().default({ maxEvents: 20, timezone: 'UTC' }),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Expands environment variables in a path string
 */
function expandEnvVars(path: string): string {
  return path.replace(/\$([A-Z_]+)/g, (_, varName) => {
    return process.env[varName] || `$${varName}`;
  });
}

/**
 * Resolves a path relative to a base directory
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
    const content = await readFile(configPath, 'utf-8');
    const rawConfig = JSON.parse(content);
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
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${error.message}`);
    }
    throw new Error(`Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
  }
}
